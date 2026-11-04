# Browser Connector integration

This is a local-only integration suite for the separately installed aux4
Browser Connector extension. It lives outside `package/test/` (in
`package/test-connector-local/`) precisely so neither the default `aux4
test run` nor CI discover and run it -- it depends on a paired extension
and would otherwise fail every time no extension is connected. Run it on
its own, from `package`, with `aux4 test run test-connector-local`. Before
running it:

1. Load or install the extension from
   `https://github.com/aux4/browser-connector/releases`.
2. Run `aux4 browser connect`.
3. Paste its token into the extension popup and click **Connect**.
4. Leave that extension-mode daemon running while the suite executes.

The preflight deliberately rejects a normal Playwright daemon, so a passing
run proves that the installed extension handled the browser operations.

## with a paired installed extension

### should have an extension-mode daemon connected

```timeout
10000
```

```execute
set -e
CONNECT_DIR="$HOME/.aux4.config/browser"
test -S "$CONNECT_DIR/browser.sock"
test -f "$CONNECT_DIR/connect.json"
PORT=$(CONNECT_FILE="$CONNECT_DIR/connect.json" node -e "const fs=require('fs'); console.log(JSON.parse(fs.readFileSync(process.env.CONNECT_FILE, 'utf8')).port)")
lsof -nP -iTCP:"$PORT" -sTCP:LISTEN | grep -q LISTEN
aux4 browser list
```

```expect:partial
[
```

```afterEach
rm -f browser-connector-screenshot.png
```

### should open and inspect a real page through the extension

```timeout
30000
```

```execute
set -e
SESSION=$(aux4 browser open --url https://example.com --timeout 2m)
aux4 browser snapshot --session "$SESSION" --format text
aux4 browser close --session "$SESSION"
```

```expect:partial
Example Domain
```

### should read page content through the extension

```timeout
30000
```

```execute
set -e
SESSION=$(aux4 browser open --url https://example.com --timeout 2m)
CONTENT=$(aux4 browser content --session "$SESSION" --format text)
printf '%s\n' "$CONTENT" | grep -F "Example Domain"
aux4 browser close --session "$SESSION"
```

```expect
Example Domain
```

### should route tab operations through the same profile connection

```timeout
30000
```

```execute
set -e
SESSION=$(aux4 browser open --url https://example.com --timeout 2m)
aux4 browser new-tab --session "$SESSION" --url https://example.com
aux4 browser list-tabs --session "$SESSION"
aux4 browser close --session "$SESSION"
```

```expect:partial
https://example.com
```

### should return a visible-tab screenshot

```timeout
30000
```

```execute
set -e
SESSION=$(aux4 browser open --url https://example.com --timeout 2m)
aux4 browser screenshot --session "$SESSION" --output browser-connector-screenshot.png
test -s browser-connector-screenshot.png
echo screenshot-ok
aux4 browser close --session "$SESSION"
```

```expect:partial
screenshot-ok
```

### should report the MV3 eval limitation

```timeout
30000
```

```execute
set -e
SESSION=$(aux4 browser open --url https://example.com --timeout 2m)
aux4 browser eval --session "$SESSION" --script "document.title"
aux4 browser close --session "$SESSION"
```

```expect:partial
MV3 blocks arbitrary eval
```
