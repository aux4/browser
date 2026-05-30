# Read

## one-shot read command

```beforeAll
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
```

```afterAll
aux4 browser stop
sleep 1
```

### should read page content in single call

```timeout
30000
```

```execute
aux4 browser read --url https://aux4.io 2>/dev/null | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('status:' + d.status);
  console.log('hasFinalUrl:' + !!d.finalUrl);
  console.log('hasContent:' + (d.content.length > 100));
"
```

```expect
status:ok
hasFinalUrl:true
hasContent:true
```

### should read page as text format

```timeout
30000
```

```execute
aux4 browser read --url https://aux4.io --format text 2>/dev/null | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('hasContent:' + d.content.includes('aux4'));
"
```

```expect
hasContent:true
```

### should reuse session and not close it

```timeout
30000
```

```execute
SESSION=$(aux4 browser open 2>/dev/null)
aux4 browser read --url https://aux4.io --session $SESSION 2>/dev/null | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('status:' + d.status);
  console.log('sessionClosed:' + (d.sessionClosed || false));
  console.log('hasSessionId:' + !!d.sessionId);
"
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
status:ok
sessionClosed:false
hasSessionId:true
```
