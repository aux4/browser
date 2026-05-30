# Wait Until

## navigation with waitUntil parameter

```beforeAll
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
```

```afterAll
aux4 browser stop
sleep 1
```

### should visit with networkidle strategy

```timeout
30000
```

```execute
SESSION=$(aux4 browser open 2>/dev/null)
RESULT=$(aux4 browser visit --session $SESSION --url https://aux4.io --waitUntil networkidle 2>/dev/null)
echo "$RESULT" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('status:' + d.status);
  console.log('hasFinalUrl:' + !!d.finalUrl);
"
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
status:ok
hasFinalUrl:true
```

### should visit with domcontentloaded strategy

```timeout
30000
```

```execute
SESSION=$(aux4 browser open 2>/dev/null)
RESULT=$(aux4 browser visit --session $SESSION --url https://aux4.io --waitUntil domcontentloaded 2>/dev/null)
echo "$RESULT" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('status:' + d.status);
"
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
status:ok
```

### should visit with settle strategy

```timeout
30000
```

```execute
SESSION=$(aux4 browser open 2>/dev/null)
RESULT=$(aux4 browser visit --session $SESSION --url https://aux4.io --waitUntil settle 2>/dev/null)
echo "$RESULT" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('status:' + d.status);
  console.log('hasFinalUrl:' + !!d.finalUrl);
"
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
status:ok
hasFinalUrl:true
```
