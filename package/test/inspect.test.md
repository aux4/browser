# Inspect

Tests the auditable CDP session and the `inspect` handshake. An auditable session
launches a persistent Chromium context with a remote debugging port so external CDP
tools (e.g. `aux4 lighthouse`) can attach to the authenticated profile.

## auditable session reports a CDP handshake

```timeout
40000
```

```execute
aux4 browser start --persistent true > /dev/null 2>&1 &
sleep 4
SESSION=$(aux4 browser open --url https://example.com --auditable true 2>/dev/null)
aux4 browser inspect --session $SESSION 2>/dev/null
aux4 browser close --session $SESSION > /dev/null 2>&1
```

```expect:regex
\{"url":"https://example\.com/?","port":\d+\}
```

## non-auditable session cannot be inspected

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url https://example.com 2>/dev/null)
aux4 browser inspect --session $SESSION 2>&1
aux4 browser close --session $SESSION > /dev/null 2>&1
```

```expect:partial
*Session is not auditable*
```

## cleanup daemon

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
