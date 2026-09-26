# frames and shadow DOM

## on a page with a web component (open shadow root) and a content iframe

```file:frames-shadow-fixture.html
<!DOCTYPE html>
<html>
<head>
  <title>Frames and Shadow Fixture</title>
</head>
<body>
  <main>
    <h1>Provider Search</h1>
    <p>Light DOM paragraph that is always visible to every walker.</p>
    <provider-card></provider-card>
    <iframe id="results" title="Search results" width="600" height="300"
      srcdoc="<html><body><h2>Frame Results</h2><p>Dr. Alice Framewell, Family Medicine, Venice CA 90292</p></body></html>"></iframe>
    <iframe id="pixel" width="1" height="1" srcdoc="<p>tracking pixel text that must not be read</p>"></iframe>
  </main>
  <script>
    customElements.define("provider-card", class extends HTMLElement {
      constructor() {
        super();
        const root = this.attachShadow({ mode: "open" });
        root.innerHTML = "<h2>Shadow Card</h2><p>Dr. Sally Shadowton, Internal Medicine, accepting new patients</p><button id='book'>Book appointment</button>";
        root.getElementById("book").addEventListener("click", () => { document.title = "booked"; });
      }
    });
  </script>
</body>
</html>
```

```beforeAll
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
```

```afterAll
aux4 browser stop
```

### blocks should include text rendered inside an open shadow root

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/frames-shadow-fixture.html")
aux4 browser blocks --session $SESSION | grep -o '"text":"Dr. Sally Shadowton[^"]*"'
aux4 browser close --session $SESSION >/dev/null
```

```expect
"text":"Dr. Sally Shadowton, Internal Medicine, accepting new patients"
```

### blocks should include a visible iframe's content tagged with its frame

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/frames-shadow-fixture.html")
aux4 browser blocks --session $SESSION | grep -o '"text":"Dr. Alice Framewell[^}]*"frame":"[^"]*"'
aux4 browser close --session $SESSION >/dev/null
```

```expect:partial
"text":"Dr. Alice Framewell, Family Medicine, Venice CA 90292"*"ref":null*"frame":"about:srcdoc"
```

### blocks should skip tiny tracking frames

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/frames-shadow-fixture.html")
aux4 browser blocks --session $SESSION | grep -c "tracking pixel"
aux4 browser close --session $SESSION >/dev/null
```

```expect
0
```

### read should return shadow root and iframe text

```timeout
30000
```

```execute
aux4 browser read --url "file://$PWD/frames-shadow-fixture.html" --format text | grep -o -e "Dr. Sally Shadowton" -e "Dr. Alice Framewell" -e "tracking pixel"
```

```expect
Dr. Sally Shadowton
Dr. Alice Framewell
```

### snapshot should give refs to elements inside a shadow root

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/frames-shadow-fixture.html")
aux4 browser snapshot --session $SESSION --format text | grep -o 'button "Book appointment"'
aux4 browser close --session $SESSION >/dev/null
```

```expect
button "Book appointment"
```

### click --ref should reach a button inside a shadow root

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/frames-shadow-fixture.html")
REF=$(aux4 browser snapshot --session $SESSION --format text | grep 'Book appointment' | sed -E 's/^ *\[([0-9]+)\].*/\1/')
aux4 browser click --session $SESSION --ref $REF >/dev/null
aux4 browser eval --session $SESSION --script "document.title"
aux4 browser close --session $SESSION >/dev/null
```

```expect:partial
booked
```

### snapshot should list visible frames with a --within selector

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/frames-shadow-fixture.html")
aux4 browser snapshot --session $SESSION --format text | grep -A1 "## Frames"
aux4 browser close --session $SESSION >/dev/null
```

```expect
## Frames
  about:srcdoc (--within '#results')
```
