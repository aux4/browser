# Content Warning

## empty content returns warning

```beforeAll
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
```

```afterAll
aux4 browser stop
sleep 1
```

### should warn on about:blank page

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url about:blank 2>/dev/null)
RESULT=$(aux4 browser content --session $SESSION --format text 2>/dev/null)
echo "content_empty:$(test -z "$RESULT" && echo true || echo false)"
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
content_empty:true
```
