# Disk Output

## write to file instead of stdout

```beforeAll
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
```

```afterAll
aux4 browser stop
sleep 1
```

### snapshot should write to file and return summary

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url https://aux4.io 2>/dev/null)
RESULT=$(aux4 browser snapshot --session $SESSION --output /tmp/aux4-test-snap.txt 2>/dev/null)
echo "$RESULT" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('hasPath:' + !!d.path);
  console.log('hasTitle:' + !!d.title);
  console.log('hasElements:' + (d.elementCount > 0));
  console.log('fileExists:' + require('fs').existsSync(d.path));
  console.log('fileHasContent:' + (require('fs').readFileSync(d.path,'utf8').length > 50));
"
rm -f /tmp/aux4-test-snap.txt
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
hasPath:true
hasTitle:true
hasElements:true
fileExists:true
fileHasContent:true
```

### content should write to file and return summary

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url https://aux4.io 2>/dev/null)
aux4 browser content --session $SESSION --output /tmp/aux4-test-content.md 2>/dev/null | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('hasPath:' + !!d.path);
  console.log('hasLength:' + (d.contentLength > 100));
  console.log('noContent:' + (d.content === undefined));
  console.log('fileExists:' + require('fs').existsSync(d.path));
"
rm -f /tmp/aux4-test-content.md
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
hasPath:true
hasLength:true
noContent:true
fileExists:true
```

### read should write to file and return summary

```timeout
30000
```

```execute
aux4 browser read --url https://aux4.io --output /tmp/aux4-test-read.md 2>/dev/null | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('hasPath:' + !!d.path);
  console.log('hasLength:' + (d.contentLength > 100));
  console.log('noContent:' + (d.content === undefined));
  console.log('hasFinalUrl:' + !!d.finalUrl);
  console.log('hasTitle:' + !!d.title);
  console.log('fileExists:' + require('fs').existsSync(d.path));
"
rm -f /tmp/aux4-test-read.md
```

```expect
hasPath:true
hasLength:true
noContent:true
hasFinalUrl:true
hasTitle:true
fileExists:true
```
