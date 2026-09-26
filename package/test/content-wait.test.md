# content wait and user agent

## a single-page app that renders after the load event

```file:spa-fixture.html
<!DOCTYPE html>
<html>
<head>
  <title>Late SPA</title>
</head>
<body>
  <app-root></app-root>
  <script>
    setTimeout(() => {
      document.querySelector("app-root").innerHTML = "<h1>Find a Healthcare Provider</h1><p>Browse or search to find the care you need.</p>";
    }, 1500);
  </script>
</body>
</html>
```

```file:empty-static.html
<!DOCTYPE html>
<html>
<head>
  <title>Empty</title>
</head>
<body></body>
</html>
```

```beforeAll
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
```

```afterAll
aux4 browser stop
```

### read should wait for the app to render its content

```timeout
30000
```

```execute
aux4 browser read --url "file://$PWD/spa-fixture.html" --format text | grep -o "Browse or search to find the care you need."
```

```expect
Browse or search to find the care you need.
```

### blocks --url should wait for the app to render its content

```timeout
30000
```

```execute
SESSION=$(aux4 browser open)
aux4 browser blocks --session $SESSION --url "file://$PWD/spa-fixture.html" | grep -o '"text":"Browse or search[^"]*"'
aux4 browser close --session $SESSION >/dev/null
```

```expect
"text":"Browse or search to find the care you need."
```

### an empty static page should not wait for content

```timeout
30000
```

```execute
START=$(date +%s)
aux4 browser read --url "file://$PWD/empty-static.html" --format text >/dev/null
END=$(date +%s)
test $((END - START)) -lt 5 && echo fast
```

```expect
fast
```

### sessions should present a regular Chrome user agent

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/empty-static.html")
aux4 browser eval --session $SESSION --script "navigator.userAgent.includes('HeadlessChrome') ? 'headless-ua' : (navigator.userAgent.includes('Chrome/') ? 'chrome-ua' : 'other')"
aux4 browser close --session $SESSION >/dev/null
```

```expect:partial
chrome-ua
```

### sessions should keep consistent user-agent client hints

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "https://example.com")
aux4 browser eval --session $SESSION --script "(() => { const b = (navigator.userAgentData && navigator.userAgentData.brands) || []; return b.length === 0 ? 'no-hints' : (b.some(x => /headless/i.test(x.brand)) ? 'headless-brand' : 'ok'); })()"
aux4 browser close --session $SESSION >/dev/null
```

```expect:partial
ok
```

## with AUX4_BROWSER_USER_AGENT set

```file:ua-page.html
<!DOCTYPE html>
<html>
<head>
  <title>UA</title>
</head>
<body><p>user agent page</p></body>
</html>
```

```beforeAll
aux4 browser stop
AUX4_BROWSER_USER_AGENT="Mozilla/5.0 aux4-test-agent" nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
```

```afterAll
aux4 browser stop
```

### should use the configured user agent

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/ua-page.html")
aux4 browser eval --session $SESSION --script "navigator.userAgent"
aux4 browser close --session $SESSION >/dev/null
```

```expect:partial
Mozilla/5.0 aux4-test-agent
```

## a site whose bot protection refuses the page's own requests

```beforeAll
nohup node -e 'const page = "<!DOCTYPE html><html><head><title>Sapphire365</title></head><body><app-root></app-root><script>fetch(\"/api/signature.json\").then(r => r.ok ? r.json() : null).then(d => { if (d) document.querySelector(\"app-root\").innerHTML = \"<h1>Find a Healthcare Provider</h1>\"; });</script></body></html>"; require("http").createServer((req, res) => { if (req.url.startsWith("/api/")) { res.writeHead(403, { "x-cdn": "Imperva", "x-iinfo": "1-2-0 PNNN" }); return res.end(); } res.writeHead(200, { "content-type": "text/html" }); res.end(page); }).listen(18457); setTimeout(() => process.exit(0), 120000);' >/dev/null 2>&1 &
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
```

```afterAll
aux4 browser stop
pkill -f "listen(18457)"
```

### read should report that bot protection kept the page from rendering

```timeout
30000
```

```execute
aux4 browser read --url "http://127.0.0.1:18457/" --format text | grep -o '"warning":"[^"]*"'
```

```expect
"warning":"the site's bot protection (Imperva) refused the page's own requests (HTTP 403), so the page did not render"
```

### visit should return the blocked details

```timeout
30000
```

```execute
SESSION=$(aux4 browser open)
aux4 browser visit --session $SESSION --url "http://127.0.0.1:18457/" | grep -o '"blocked":{"status":403,"requests":1,"vendor":"Imperva"'
aux4 browser close --session $SESSION >/dev/null
```

```expect
"blocked":{"status":403,"requests":1,"vendor":"Imperva"
```
