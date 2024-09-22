# About

`yawpp` stands for **Y**et **A**nother **W**ord**P**ress **P**oster. 

`yawpp` includes two scripts, `checker.js` and `poster.js`.

`checker.js` checks validity of Wordpress credentials using two methods: http wplogin and [wordpress xmlrpc API](https://codex.wordpress.org/XML-RPC_WordPress_API/Posts). The script works fast with configurable number of simultaneous requests.

`poster.js` creates posts using wordpress xml rpc api. So, it requires wp site to have enabled xml rpc api. The script posts sequentially. 

# Installation

You should have `nodejs` and `npm` to be installed on your system. The recommended way is to first install [nvm](https://github.com/nvm-sh/nvm) and then use it for node installation:

```bash
nvm install --lts
```

Having `nodejs` on your system, clone the repo and install dependencies:

```bash
git clone git@bitbucket.org:0xsky/yawpp.git
cd yawpp
npm install
```

Now you are ready to use `yawpp`.

# Checker

## Example 1

Getting help.

```bash
node src/checker.js --help
```

## Example 2

Checks with default 10 requests in parallel.

```bash
node src/checker.js -t targets.txt
```

## Example 3

Checks with 100 requests in parallel with non-default separator ":" (default is ";")

```bash
node src/checker.js -t targets.txt -n 100 -s :
```

Note: a separator can be only a single character. When specifying on command line, don't include into double quotes.

## Result format

### Output sample 

```txt
node src/checker.js -t /tmp/wp.txt 
nBulks: 2, nReq: 10
bulk: 0, startIdx: 0 endIdx: 10
login|http://localhost;user1;pass1|false|false
login|http://localhost;user2;pass2|false|false
login|http://localhost;user3;pass3|false|false
login|http://localhost;user4;pass4|false|false
login|http://localhost;user5;pass5|false|false
login|http://localhost;user6;pass6|false|false
login|http://localhost;user7;pass7|false|false
login|http://localhost;user8;pass8|false|false
login|http://localhost;user9;pass9|false|false
login|http://localhost;user10;pass10|false|false
bulk: 1, startIdx: 10 endIdx: 20
login|http://localhost;user11;pass11|false|false
login|http://localhost;user12;pass12|false|false
login|http://localhost;user13;pass13|false|false
login|http://localhost;user14;pass14|false|false
login|http://localhost;user15;pass15|false|false
login|http://localhost;user16;pass16|false|false
login|http://localhost;user17;pass17|false|false
login|http://localhost;user18;pass18|false|false
login|http://localhost;user19;pass19|false|false
login|http://localhost;user20;pass20|false|false
```

The result lines are in the following format:

```
login|line|wpLoginOk|xmlLoginOk
```

* **login**: just a string *login*.
* **line**: domain, e.g. *http://localhost*.
* **wpLoginOk**: *true* if login was successful; note: username and password maybe ok but login may fail because of cloudflare check, for example.
* **xmlLoginOk**: *true* if login by xml rpc api was successful.


# Poster

## Example 1

Getting help.

```bash
node src/poster.js --help
```

## Example 2

Target lines are in `wp.txt` (option `-t`) file, posts in html format are kept in `posts` folder (option `-p`), start from line `10` (option `-f`), avoid duplicates `true` (option `-a`), maximum posts to do `100` (option `-m`), update wordpress author biography from file `bio.html` (option `-b`), update wordpress author website to `http://mysite.net` (option `-w`):

```bash
node src/poster.js -t wp.txt -p posts/  -f 10 -a true  -m 100 -b bio.html -w https://mysite.net
```

## Features

* Posts are in HTML format.
* Posts are randomly picked up from the post folder.
* Biography and website can be updated along with adding a post, too. 
* Date of a post is taken randomly from the past year.
* With `-a` (`--noduplicate`) option set to true, the script will search for a post in the wordpress site with the same title as a chosen post for publishing and
will not publish the post again if already found on the site. Note, that this can be very slow and so by default this option is set to false.
* The biography of the wordpress author is updated from a file specified by `-b` option. For example, the file can contain `
Trusted by <a href="http://myfile.com">http://myfile.com</a>`
* The website of the wordpress author is updated from an argument of `-w` option, for example `-w https://myfile.net`. 

## Output sample

```text
2981|login|http://kolon.pl/;kowin_admin;1212KP!|true|true|true|true
2981|post|http://kolon.pl/;kowin_admin;1212KP!|8527|15|0
2981|bio|http://kolon.pl/;kowin_admin;1212KP!|true
```

### Format of *login* action:

```text
lineNumber|line|wpLogin.usernameOk|wpLogin.passwordOk|wpLogin.loggedIn|xmlLoginOk
```

The same format as in checker.

### Format of *post* action:

```text
lineNumber|post|line|postid|successfulPosts|duplicatedPosts
```

* **lineNumber**: line number processed.
* **post**: action name, *post*, for publishing a post.
* **line**: domain, e.g. *http://localhost*.
* **postid**: post id made for that line.
* **successfulPosts**: number of successful posts till now including the current post if successful
* **duplacatedPosts**: number of found duplicacted posts till now

### Format of *biography* action

```text
lineNumber|bio|line|status
```

* **lineNumber**: line number processed.
* **bio**: action name, *bio* for updating biography.
* **line**: domain, e.g. *http://localhost**
* **status**: *true* for success, *false* for failure

**--END**
