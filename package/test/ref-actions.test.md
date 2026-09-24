# Ref-targeted actions

## type, select, check, uncheck by snapshot ref

```beforeAll
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
```

```afterAll
aux4 browser stop
sleep 1
```

### should type into a field addressed by --ref

```timeout
30000
```

```file:ref-fixture.html
<html>
<body>
  <label for="name">Name</label>
  <input id="name" type="text" />
  <label for="color">Color</label>
  <select id="color">
    <option value="">Choose</option>
    <option value="red">Red</option>
    <option value="blue">Blue</option>
  </select>
  <label for="agree">Agree</label>
  <input id="agree" type="checkbox" />
</body>
</html>
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/ref-fixture.html" 2>/dev/null)
SNAP=$(aux4 browser snapshot --session $SESSION 2>/dev/null)
REF=$(echo "$SNAP" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).snapshot.elements.find(e => e.role === 'textbox').ref")
aux4 browser type --session $SESSION --ref $REF --value "Jane Doe" 2>/dev/null | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).status"
aux4 browser eval --session $SESSION --script "document.getElementById('name').value" 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
ok
Jane Doe
```

### should select an option addressed by --ref

```timeout
30000
```

```file:ref-fixture.html
<html>
<body>
  <label for="name">Name</label>
  <input id="name" type="text" />
  <label for="color">Color</label>
  <select id="color">
    <option value="">Choose</option>
    <option value="red">Red</option>
    <option value="blue">Blue</option>
  </select>
  <label for="agree">Agree</label>
  <input id="agree" type="checkbox" />
</body>
</html>
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/ref-fixture.html" 2>/dev/null)
SNAP=$(aux4 browser snapshot --session $SESSION 2>/dev/null)
REF=$(echo "$SNAP" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).snapshot.elements.find(e => e.role === 'combobox').ref")
aux4 browser select --session $SESSION --ref $REF --value "blue" 2>/dev/null | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).status"
aux4 browser eval --session $SESSION --script "document.getElementById('color').value" 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
ok
blue
```

### should check and uncheck a checkbox addressed by --ref

```timeout
30000
```

```file:ref-fixture.html
<html>
<body>
  <label for="name">Name</label>
  <input id="name" type="text" />
  <label for="color">Color</label>
  <select id="color">
    <option value="">Choose</option>
    <option value="red">Red</option>
    <option value="blue">Blue</option>
  </select>
  <label for="agree">Agree</label>
  <input id="agree" type="checkbox" />
</body>
</html>
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/ref-fixture.html" 2>/dev/null)
SNAP=$(aux4 browser snapshot --session $SESSION 2>/dev/null)
REF=$(echo "$SNAP" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).snapshot.elements.find(e => e.role === 'checkbox').ref")
aux4 browser check --session $SESSION --ref $REF 2>/dev/null | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).status"
aux4 browser eval --session $SESSION --script "document.getElementById('agree').checked" 2>/dev/null
aux4 browser uncheck --session $SESSION --ref $REF 2>/dev/null | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).status"
aux4 browser eval --session $SESSION --script "document.getElementById('agree').checked" 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
ok
true
ok
false
```
</content>
