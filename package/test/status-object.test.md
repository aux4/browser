# Status Object

## open with URL returns status object

```beforeAll
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
```

```afterAll
aux4 browser stop
sleep 1
```

### should return finalUrl and title on open with snapshot

```timeout
30000
```

```execute
aux4 browser open --url https://aux4.io --snapshot auto 2>/dev/null | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('hasSessionId:' + !!d.sessionId);
  console.log('hasFinalUrl:' + !!d.finalUrl);
  console.log('hasTitle:' + (d.title !== undefined));
  if (d.sessionId) require('child_process').execSync('aux4 browser close --session ' + d.sessionId, {stdio:'ignore'});
"
```

```expect
hasSessionId:true
hasFinalUrl:true
hasTitle:true
```

## visit returns status object

### should return finalUrl and title on visit

```timeout
30000
```

```execute
SESSION=$(aux4 browser open 2>/dev/null)
RESULT=$(aux4 browser visit --session $SESSION --url https://aux4.io 2>/dev/null)
echo "$RESULT" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('hasStatus:' + (d.status === 'ok'));
  console.log('hasFinalUrl:' + !!d.finalUrl);
  console.log('hasTitle:' + (d.title !== undefined));
"
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
hasStatus:true
hasFinalUrl:true
hasTitle:true
```
