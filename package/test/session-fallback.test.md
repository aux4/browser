# session fallback (BRW-010)

Every command that takes `--session` falls back to the only/most-recently-used open session when it is
omitted, the same way `visit` already did — so an agent that just ran `open` can call the next command
without re-pasting the session id, and a stale/no-session call errors instead of hanging on an interactive
prompt.

```file:session-fallback-fixture.html
<!DOCTYPE html>
<html>
<head><title>Session Fallback Fixture</title></head>
<body>
  <form aria-label="Contact">
    <label for="name">Name</label>
    <input id="name" name="name" type="text">
  </form>
</body>
</html>
```

```beforeAll
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
```

```afterAll
aux4 browser stop
sleep 1
```

## fill without --session

### should fill the only open session's field

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/session-fallback-fixture.html" 2>/dev/null)
aux4 browser fill --field Name --value Ann 2>/dev/null
aux4 browser eval --session $SESSION --script "document.getElementById('name').value" 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect:partial
Ann
```

## screenshot without --session

### should fall back to the only open session instead of prompting

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/session-fallback-fixture.html" 2>/dev/null)
aux4 browser screenshot --output /tmp/aux4-browser-session-fallback-test.png
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect:partial
aux4-browser-session-fallback-test.png
```

## click without --session

### should click in the only open session

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/session-fallback-fixture.html" 2>/dev/null)
aux4 browser type --name Name --value Bob 2>/dev/null
aux4 browser eval --session $SESSION --script "document.getElementById('name').value" 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect:partial
Bob
```

## no --session and no open session at all

### should report a clear error naming the exact open command, not prompt

```timeout
30000
```

```execute
aux4 browser stop >/dev/null 2>&1
sleep 1
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
aux4 browser fill --field Name --value Ann
EXIT=$?
echo "exit:$EXIT"
```

```error:partial
No --session given and no active sessions. Run: aux4 browser open *?
```

```expect:partial
exit:1
```

## two open sessions, no --session

### should fall back to the most recently used one

```timeout
30000
```

```execute
FIRST=$(aux4 browser open --url "file://$PWD/session-fallback-fixture.html" 2>/dev/null)
SECOND=$(aux4 browser open --url "file://$PWD/session-fallback-fixture.html" 2>/dev/null)
aux4 browser fill --field Name --value Second 2>/dev/null
aux4 browser eval --session $SECOND --script "document.getElementById('name').value" 2>/dev/null
aux4 browser eval --session $FIRST --script "document.getElementById('name').value" 2>/dev/null
aux4 browser close --session $FIRST >/dev/null 2>&1
aux4 browser close --session $SECOND >/dev/null 2>&1
```

```expect:partial
Second
```
