# visit

```file:visit-fixture-a.html
<html><head><title>Visit A</title></head><body>a</body></html>
```

```file:visit-fixture-b.html
<html><head><title>Visit B</title></head><body>b</body></html>
```

```beforeAll
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
```

```afterAll
aux4 browser stop
sleep 1
```

## visit with a positional URL

```timeout
30000
```

### should navigate using the positional url argument

```execute
SESSION=$(aux4 browser open --url "file://$PWD/visit-fixture-a.html" 2>/dev/null)
aux4 browser visit --session $SESSION "file://$PWD/visit-fixture-b.html" 2>/dev/null
aux4 browser eval --session $SESSION --script "document.title" 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect:partial
Visit B
```

## visit without --session

### should fall back to the most recently used session

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/visit-fixture-a.html" 2>/dev/null)
aux4 browser visit "file://$PWD/visit-fixture-b.html" 2>/dev/null
aux4 browser eval --session $SESSION --script "document.title" 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect:partial
Visit B
```

### should report a clear error when no sessions are active

```timeout
30000
```

```execute
aux4 browser stop >/dev/null 2>&1
sleep 1
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
aux4 browser visit "file://$PWD/visit-fixture-a.html"
EXIT=$?
echo "exit:$EXIT"
```

```error:partial
No --session given and no active sessions. Run: aux4 browser open *?
```

```expect:partial
exit:1
```
