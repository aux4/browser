# Click within iframe

The `--within` option scopes `click-selector` (and `click`, `click-text`, `type`)
inside an iframe using Playwright's frameLocator, reaching content that the
default main-frame search cannot. Nest multiple frames by joining selectors
with `>>>`.

The child reports the click to the parent via `postMessage` (cross-origin safe,
since `file://` documents are opaque origins and the parent cannot read the
child's DOM directly).

## within an iframe

```beforeAll
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
```

```afterAll
aux4 browser stop
sleep 1
```

```file:within-child.html
<html>
<body>
  <button id="b" onclick="window.parent.postMessage('clicked-inside','*')">Press</button>
</body>
</html>
```

```file:within-parent.html
<html>
<body>
  <script>window.__msg = 'idle'; addEventListener('message', function (e) { window.__msg = e.data; });</script>
  <iframe id="f" src="within-child.html" width="300" height="200"></iframe>
</body>
</html>
```

### should click a button inside the iframe and register the event

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/within-parent.html" 2>/dev/null)
sleep 1
aux4 browser click-selector --session $SESSION --selector "#b" --within "iframe#f" 2>/dev/null | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).status"
aux4 browser eval --session $SESSION --script "window.__msg" 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
ok
clicked-inside
```

### should not reach iframe content without --within

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/within-parent.html" 2>/dev/null)
sleep 1
aux4 browser click-selector --session $SESSION --selector "#b" 2>/dev/null | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).reason"
aux4 browser eval --session $SESSION --script "window.__msg" 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
timeout
idle
```
