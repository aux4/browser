# Click

## click features

```beforeAll
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
```

```afterAll
aux4 browser stop
sleep 1
```

### should click by snapshot ref index

```timeout
30000
```

```file:click-fixture.html
<html>
<body>
  <button id="btn1" onclick="document.getElementById('result').textContent='clicked'">Click Me</button>
  <div id="result"></div>
</body>
</html>
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/click-fixture.html" 2>/dev/null)
SNAP=$(aux4 browser snapshot --session $SESSION 2>/dev/null)
REF=$(echo "$SNAP" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).snapshot.elements[0].ref")
aux4 browser click --session $SESSION --ref $REF 2>/dev/null | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).status"
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
ok
```

### should return structured timeout on click failure

```timeout
30000
```

```file:click-fixture.html
<html>
<body>
  <p>No buttons here</p>
</body>
</html>
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/click-fixture.html" 2>/dev/null)
RESULT=$(aux4 browser click --session $SESSION --name "Nonexistent Button" --timeout 2000 2>/dev/null)
echo "$RESULT" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('clicked:' + d.clicked);
  console.log('reason:' + d.reason);
  console.log('hasDescription:' + !!d.description);
"
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
clicked:false
reason:timeout
hasDescription:true
```
