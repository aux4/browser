# Read

## one-shot read command

```beforeAll
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
```

```afterAll
aux4 browser stop
sleep 1
```

### should read page content in single call

```timeout
30000
```

```execute
aux4 browser read --url https://aux4.io 2>/dev/null | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('status:' + d.status);
  console.log('hasFinalUrl:' + !!d.finalUrl);
  console.log('hasContent:' + (d.content.length > 100));
"
```

```expect
status:ok
hasFinalUrl:true
hasContent:true
```

### should read page as text format

```timeout
30000
```

```execute
aux4 browser read --url https://aux4.io --format text 2>/dev/null | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('hasContent:' + d.content.includes('aux4'));
"
```

```expect
hasContent:true
```

### should reuse session and not close it

```timeout
30000
```

```execute
SESSION=$(aux4 browser open 2>/dev/null)
aux4 browser read --url https://aux4.io --session $SESSION 2>/dev/null | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('status:' + d.status);
  console.log('sessionClosed:' + (d.sessionClosed || false));
  console.log('hasSessionId:' + !!d.sessionId);
"
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
status:ok
sessionClosed:false
hasSessionId:true
```

## readable content only

```file:read-fixture.html
<!DOCTYPE html>
<html>
<head>
  <title>Read Fixture</title>
  <script type="application/ld+json">{"@context": "https://schema.org", "headMarker": "ld-json-in-head"}</script>
</head>
<body>
  <script>window.adobeDataLayer = window.adobeDataLayer || []; var inlineMarker = "inline-js-marker";</script>
  <style>.hero { color: red; } /* style-marker */</style>
  <noscript>noscript-marker</noscript>
  <template><p>template-marker</p></template>
  <header><a href="/login">Log In</a></header>
  <nav>
    <a href="/home">Home</a>
    <a href="/find-care">Find Care</a>
  </nav>
  <main>
    <h1>Find a Doctor</h1>
    <p>Search our network of primary care doctors.</p>
    <a href="/find-care/search">
      Search Doctors
    </a>
    <script type="application/ld+json">{"@context": "https://schema.org", "bodyMarker": "ld-json-in-body"}</script>
  </main>
  <div id="state">{"page": {"id": "find-care", "blobMarker": "embedded-json-blob", "items": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "description": "an embedded state dump rendered as text that nobody reads, long enough to be clearly a data blob and not a sentence a person would ever read on the page"}}</div>
  <footer><a href="/privacy">Privacy Policy</a></footer>
</body>
</html>
```

```beforeAll
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
```

```afterAll
aux4 browser stop
sleep 1
```

### should drop scripts, styles, JSON-LD and data blobs and put the main content first

```timeout
30000
```

```execute
aux4 browser read --url "file://$PWD/read-fixture.html" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const c = d.content;
  for (const m of ['inline-js-marker', 'adobeDataLayer', 'style-marker', 'noscript-marker', 'template-marker', 'ld-json-in-head', 'ld-json-in-body', 'embedded-json-blob']) {
    console.log(m + ':' + c.includes(m));
  }
  console.log('startsWithMain:' + c.startsWith('# Find a Doctor'));
  console.log('multiLineLink:' + c.includes('[Search Doctors](/find-care/search)'));
  console.log('navAfterMain:' + (c.indexOf('[Find Care](/find-care)') > c.indexOf('Search our network')));
"
```

```expect
inline-js-marker:false
adobeDataLayer:false
style-marker:false
noscript-marker:false
template-marker:false
ld-json-in-head:false
ld-json-in-body:false
embedded-json-blob:false
startsWithMain:true
multiLineLink:true
navAfterMain:true
```

### should drop scripts in text format too

```timeout
30000
```

```execute
aux4 browser read --url "file://$PWD/read-fixture.html" --format text | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('hasScript:' + d.content.includes('inline-js-marker'));
  console.log('startsWithMain:' + d.content.startsWith('Find a Doctor'));
"
```

```expect
hasScript:false
startsWithMain:true
```
