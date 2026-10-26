# Start

## browser help

```execute
aux4 browser --help 2>/dev/null | head -2
```

```expect
browser
Headless browser automation.
```

## start and stop daemon

```timeout
30000
```

```execute
aux4 browser start --persistent true > /dev/null 2>&1 &
sleep 4
aux4 browser list 2>/dev/null
```

```expect
[]
```

```timeout
10000
```

```execute
aux4 browser stop > /dev/null 2>&1
sleep 1
echo "done"
```

```expect
done
```

## upgrade an already-running daemon to persistent (BRW-013)

An implicit, non-persistent autostart (the common case: the first browser
call of a task opens a session with no `--persistent` flag at all) must be
upgradable in place by a later `start --persistent true` — not a no-op that
leaves the daemon exitable the moment its session count returns to zero.

```timeout
30000
```

```beforeAll
aux4 browser stop > /dev/null 2>&1
sleep 1
```

```afterAll
aux4 browser stop > /dev/null 2>&1
```

### a later start --persistent true upgrades it, and closing the last session no longer stops it

```execute
SESSION=$(aux4 browser open --url "about:blank" 2>/dev/null)
PID1=$(cat ~/.aux4.config/browser/browser.pid)
aux4 browser start --persistent true > /dev/null 2>&1
aux4 browser close --session "$SESSION" > /dev/null 2>&1
sleep 1
PID2=$(cat ~/.aux4.config/browser/browser.pid 2>/dev/null)
if [ "$PID1" = "$PID2" ] && [ -n "$PID2" ]; then echo "same-daemon-survived"; else echo "daemon-died: $PID1 -> $PID2"; fi
```

```expect
same-daemon-survived
```
