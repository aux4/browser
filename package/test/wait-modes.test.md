# Wait Modes

## broadened wait command

```beforeAll
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
```

```afterAll
aux4 browser stop
sleep 1
```

### should wait for networkidle

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url https://aux4.io 2>/dev/null)
RESULT=$(aux4 browser wait --session $SESSION --selector networkidle 2>/dev/null)
echo "$RESULT" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('status:' + d.status);
  console.log('mode:' + d.mode);
"
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
status:ok
mode:networkidle
```

### should wait for settle

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url https://aux4.io 2>/dev/null)
RESULT=$(aux4 browser wait --session $SESSION --selector settle 2>/dev/null)
echo "$RESULT" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('status:' + d.status);
  console.log('mode:' + d.mode);
"
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
status:ok
mode:settle
```

### should return structured timeout on failure

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url https://aux4.io 2>/dev/null)
RESULT=$(aux4 browser wait --session $SESSION --selector ".nonexistent-element-xyz" --timeout 2000 2>/dev/null)
echo "$RESULT" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('timedOut:' + d.timedOut);
  console.log('hasWaitedFor:' + !!d.waitedFor);
  console.log('hasCurrentUrl:' + !!d.currentUrl);
"
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
timedOut:true
hasWaitedFor:true
hasCurrentUrl:true
```

### should wait for text

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url https://aux4.io 2>/dev/null)
RESULT=$(aux4 browser wait --session $SESSION --selector "text=aux4" 2>/dev/null)
echo "$RESULT" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('status:' + d.status);
  console.log('mode:' + d.mode);
"
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
status:ok
mode:text
```
