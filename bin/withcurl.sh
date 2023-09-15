#!/bin/bash

# Just test status
curl -vv -H "Cookie: wordpress_test_cookie=WP%20Cookie%20check" -c cookie.txt -d "log=user" -d "pwd=123456" -d "wp-submit=Log In" -d "redirect_to=http://192.168.1.21/wp-admin" -d "testcookie=1" "http://192.168.1.21/wp-login.php"
