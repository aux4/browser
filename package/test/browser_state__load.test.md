# browser state load

```beforeAll
nohup node -e "require('http').createServer((q,r)=>{r.setHeader('content-type','text/html');r.end('<html><head><title>state</title></head><body>ok</body></html>')}).listen(18932)" > /dev/null 2>&1 &
nohup aux4 browser start --persistent true > /dev/null 2>&1 &
sleep 3
```

```afterAll
aux4 browser stop > /dev/null 2>&1
pkill -f "listen\(18932\)" || true
sleep 1
```

## restore into a brand new session

```file:state.json
{
  "cookies": [
    {
      "name": "sid",
      "value": "abc",
      "domain": "127.0.0.1",
      "path": "/",
      "expires": -1,
      "httpOnly": false,
      "secure": false,
      "sameSite": "Lax"
    }
  ],
  "origins": [
    {
      "origin": "http://127.0.0.1:18932",
      "localStorage": [
        {
          "name": "token",
          "value": "t1"
        }
      ]
    }
  ]
}
```

```timeout
30000
```

### should restore cookies and localStorage for the saved origin

```execute
SESSION=$(aux4 browser open | tail -1)
aux4 browser state load --session $SESSION --file state.json
aux4 browser visit --session $SESSION --url http://127.0.0.1:18932/ > /dev/null
aux4 browser eval --session $SESSION --script "document.cookie + '|' + localStorage.getItem('token')"
aux4 browser close --session $SESSION > /dev/null 2>&1
```

```expect
{"status":"loaded","cookies":1,"origins":1}
sid=abc|t1
```

### should not overwrite a localStorage key the page already set

```execute
SESSION=$(aux4 browser open --url http://127.0.0.1:18932/ | tail -1)
aux4 browser eval --session $SESSION --script "localStorage.setItem('token','newer'); 1" > /dev/null
aux4 browser state load --session $SESSION --file state.json > /dev/null
aux4 browser reload --session $SESSION > /dev/null
aux4 browser eval --session $SESSION --script "localStorage.getItem('token')"
aux4 browser close --session $SESSION > /dev/null 2>&1
```

```expect
newer
```

## with a missing file

### should fail with a clear error

```execute
SESSION=$(aux4 browser open | tail -1)
aux4 browser state load --session $SESSION --file does-not-exist.json 2>&1
aux4 browser close --session $SESSION > /dev/null 2>&1
```

```expect:partial
state load: cannot read storage state from does-not-exist.json: ENOENT
```
