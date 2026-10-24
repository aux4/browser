# snapshot

## on a simple page

```file:snapshot-fixture.html
<!DOCTYPE html>
<html>
<head><title>Snapshot Fixture</title></head>
<body>
  <h1>Snapshot Test</h1>
  <button>Click Me</button>
  <a href="/next">Next</a>
  <input type="text" aria-label="Search">
  <table aria-label="Results">
    <thead><tr><th>Name</th></tr></thead>
    <tbody><tr><td>Row 1</td></tr></tbody>
  </table>
  <label for="plan">Plan</label>
  <select id="plan">
    <option value="">Choose</option>
    <option value="pro">Pro</option>
    <option value="basic">Basic</option>
  </select>
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

### should return a snapshot containing the page title

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/snapshot-fixture.html")
aux4 browser snapshot --session $SESSION --mode auto | grep -o '"title":"[^"]*"'
aux4 browser close --session $SESSION >/dev/null
```

```expect
"title":"Snapshot Fixture"
```

### should include the button element

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/snapshot-fixture.html")
aux4 browser snapshot --session $SESSION --mode auto | grep -o '"role":"button"' | head -1
aux4 browser close --session $SESSION >/dev/null
```

```expect
"role":"button"
```

### should include the table as a component

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/snapshot-fixture.html")
aux4 browser snapshot --session $SESSION --mode auto | grep -o '"type":"table"' | head -1
aux4 browser close --session $SESSION >/dev/null
```

```expect
"type":"table"
```

### should render as text format

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/snapshot-fixture.html")
aux4 browser snapshot --session $SESSION --mode auto --format text | grep -m1 "Snapshot Fixture"
aux4 browser close --session $SESSION >/dev/null
```

```expect:partial
Snapshot Fixture
```

### should label a select by its <label for> text, not its option text

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/snapshot-fixture.html")
aux4 browser snapshot --session $SESSION --mode auto --format text | grep -m1 "combobox"
aux4 browser close --session $SESSION >/dev/null
```

```expect:partial
combobox "Plan"
```
