# browser state save

The storage state is a credential (session cookies), so it is written to a file created with mode `0600` and the
command itself prints only counts. A tiny local HTTP server gives the page a real origin (file:// has no
localStorage).

```beforeAll
nohup node -e "require('http').createServer((q,r)=>{r.setHeader('content-type','text/html');r.end('<html><head><title>state</title></head><body>ok</body></html>')}).listen(18931)" > /dev/null 2>&1 &
nohup aux4 browser start --persistent true > /dev/null 2>&1 &
sleep 3
```

```afterAll
aux4 browser stop > /dev/null 2>&1
pkill -f "listen\(18931\)" || true
rm -rf state-out
sleep 1
```

## with cookies and localStorage on the page

```timeout
30000
```

### should write the state file with mode 0600 and print only counts

```execute
SESSION=$(aux4 browser open --url http://127.0.0.1:18931/ | tail -1)
aux4 browser eval --session $SESSION --script "document.cookie='sid=abc; path=/'; localStorage.setItem('token','t1'); 1" > /dev/null
aux4 browser state save --session $SESSION --output state-out/state.json
node -e "const fs=require('fs');const s=JSON.parse(fs.readFileSync('state-out/state.json','utf8'));console.log('mode:'+(fs.statSync('state-out/state.json').mode&0o777).toString(8));console.log('cookie:'+s.cookies[0].name+'='+s.cookies[0].value);console.log('ls:'+s.origins[0].origin+' '+s.origins[0].localStorage[0].name)"
aux4 browser close --session $SESSION > /dev/null 2>&1
```

```expect
{"status":"saved","path":"state-out/state.json","cookies":1,"origins":1}
mode:600
cookie:sid=abc
ls:http://127.0.0.1:18931 token
```

## without --output

### should fail with a clear error

```execute
SESSION=$(aux4 browser open | tail -1)
aux4 browser state save --session $SESSION 2>&1
aux4 browser close --session $SESSION > /dev/null 2>&1
```

```expect:partial
state save: --output <file> is required
```
