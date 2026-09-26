# Selector-targeted actions

`type`, `select`, `check` and `uncheck` accept `--selector` (a CSS selector that
pierces open shadow roots) and `--within` (an iframe), and `eval` accepts
`--within` to run a script inside a frame's document.

```beforeAll
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
```

```afterAll
aux4 browser stop
sleep 1
```

```file:selector-child.html
<html>
<body>
  <input id="inner" type="text" />
  <input id="innerbox" type="checkbox" />
</body>
</html>
```

```file:selector-fixture.html
<html>
<body>
  <input id="name" type="text" data-x="1" />
  <select id="color">
    <option value="">Choose</option>
    <option value="red">Red</option>
    <option value="blue">Blue</option>
  </select>
  <input id="agree" type="checkbox" checked />
  <div id="host"></div>
  <iframe id="f" src="selector-child.html" width="300" height="200"></iframe>
  <script>
    const root = document.getElementById("host").attachShadow({ mode: "open" });
    root.innerHTML = '<input id="shadowed" type="text" />';
  </script>
</body>
</html>
```

## main document

### should type, select, check and uncheck by --selector

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/selector-fixture.html" 2>/dev/null)
aux4 browser type --session $SESSION --selector "[data-x='1']" --value "Jane Doe" 2>/dev/null | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).status"
aux4 browser select --session $SESSION --selector "#color" --value "blue" 2>/dev/null | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).status"
aux4 browser uncheck --session $SESSION --selector "#agree" 2>/dev/null | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).status"
aux4 browser eval --session $SESSION --script "[document.getElementById('name').value, document.getElementById('color').value, String(document.getElementById('agree').checked)].join(',')" 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
ok
ok
ok
Jane Doe,blue,false
```

### should type into an input inside an open shadow root

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/selector-fixture.html" 2>/dev/null)
aux4 browser type --session $SESSION --selector "#shadowed" --value "in shadow" 2>/dev/null | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).status"
aux4 browser eval --session $SESSION --script "document.getElementById('host').shadowRoot.getElementById('shadowed').value" 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
ok
in shadow
```

## inside an iframe

### should type and check inside a frame and read it back with eval --within

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/selector-fixture.html" 2>/dev/null)
aux4 browser type --session $SESSION --selector "#inner" --within "iframe#f" --value "framed" 2>/dev/null | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).status"
aux4 browser check --session $SESSION --selector "#innerbox" --within "iframe#f" 2>/dev/null | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).status"
aux4 browser eval --session $SESSION --within "iframe#f" --script "document.getElementById('inner').value + ',' + document.getElementById('innerbox').checked" 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
ok
ok
framed,true
```

### should report a missing frame for eval --within

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/selector-fixture.html" 2>/dev/null)
aux4 browser eval --session $SESSION --within "iframe#nope" --script "1" 2>&1 | grep -c "Timeout\|no frame"
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
1
```
