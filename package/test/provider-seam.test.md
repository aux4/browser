# Provider seam (--provider on open/close)

These tests exercise aux4/browser core's provider seam (CBR-008) without any real cloud provider: `mock-open`
/ `mock-attach` / `mock-close` / `broken-open` are TEST-FIXTURE-ONLY private commands (see package/.aux4) that
stand in for a plugin like aux4/browser-agentcore. They return a `wsUrl` core cannot actually connect to
(`ws://127.0.0.1:1/mock`, a refused connection), so what's being verified is the DISPATCH and ERROR HANDLING of
the seam — that core calls out to `<provider>-open`/`-attach`/`-close`, hands the response straight to
`connectOverCDP`, and never silently falls back to a local browser when a provider is requested and fails. The
real happy-path (a provider that actually connects) is covered live against Amazon Bedrock AgentCore, not here.

## open --provider dispatches to <provider>-open

```timeout
30000
```

### should call the provider and surface its connectOverCDP failure, not open a local browser

```execute
aux4 browser stop > /dev/null 2>&1
sleep 1
aux4 browser open --provider mock --timeout 30s 2>&1
aux4 browser list 2>/dev/null
aux4 browser stop > /dev/null 2>&1
echo done
```

```expect:partial
ECONNREFUSED 127.0.0.1:1
```

```expect:partial
[]
```

```expect:partial
done
```

## open --provider with an unregistered provider

### should fail loud naming the provider, never fall back to local

```execute
aux4 browser stop > /dev/null 2>&1
sleep 1
aux4 browser open --provider does-not-exist --timeout 30s 2>&1
aux4 browser list 2>/dev/null
aux4 browser stop > /dev/null 2>&1
echo done
```

```expect:partial
is unavailable or failed on open: Command not found: does-not-exist-open
```

```expect:partial
[]
```

```expect:partial
done
```

## open --provider whose -open returns invalid JSON

### should fail loud instead of treating garbage output as a session

```execute
aux4 browser stop > /dev/null 2>&1
sleep 1
aux4 browser open --provider broken --timeout 30s 2>&1
aux4 browser list 2>/dev/null
aux4 browser stop > /dev/null 2>&1
echo done
```

```expect:partial
returned invalid JSON
```

```expect:partial
[]
```

```expect:partial
done
```

## close --session on a provider-prefixed id reattaches first (CBR-007)

A brand new daemon (started fresh below, nothing tracked locally) receiving `close --session mock:<token>`
must resolve the provider from the id and reattach BEFORE closing — never silently treat an unknown session as
already closed, and never open a local browser for it.

### should resolve via the provider on close, not silently no-op or fall back to local

```execute
aux4 browser stop > /dev/null 2>&1
sleep 1
aux4 browser close --session mock:sometoken 2>&1
aux4 browser list 2>/dev/null
aux4 browser stop > /dev/null 2>&1
echo done
```

```expect:partial
ECONNREFUSED 127.0.0.1:1
```

```expect:partial
[]
```

```expect:partial
done
```

## close --session on an id whose provider isn't installed

### should fail loud naming the provider, never silently succeed or fall back to local

```execute
aux4 browser stop > /dev/null 2>&1
sleep 1
aux4 browser close --session does-not-exist:sometoken 2>&1
aux4 browser stop > /dev/null 2>&1
echo done
```

```expect:partial
is unavailable or failed on attach: Command not found: does-not-exist-attach
```

```expect:partial
done
```

## a plain local session id is unaffected by the provider seam

### should still work exactly as before (no ":" in the id, provider="local")

```timeout
30000
```

```execute
aux4 browser stop > /dev/null 2>&1
sleep 1
aux4 browser start --persistent true > /dev/null 2>&1 &
sleep 4
SESSION=$(aux4 browser open 2>/dev/null)
echo "$SESSION" | grep -q ":" && echo "FAIL: local id contains a colon" || echo "ok: no colon"
aux4 browser close --session $SESSION > /dev/null 2>&1
aux4 browser stop > /dev/null 2>&1
echo done
```

```expect:partial
ok: no colon
```

```expect:partial
done
```

## built-in cdp provider (open --provider cdp --cdpUrl)

```timeout
30000
```

### should require --cdpUrl

```execute
aux4 browser stop > /dev/null 2>&1
sleep 1
aux4 browser open --provider cdp --timeout 30s 2>&1
aux4 browser stop > /dev/null 2>&1
echo done
```

```expect:partial
requires --cdpUrl
```

### should reject a non-WebSocket URL

```execute
aux4 browser stop > /dev/null 2>&1
sleep 1
aux4 browser open --provider cdp --cdpUrl https://example.com --timeout 30s 2>&1
aux4 browser stop > /dev/null 2>&1
echo done
```

```expect:partial
session token is not a ws:// or wss:// URL
```

### should attach straight to the URL (no plugin) and surface its connect failure, never open a local browser

```execute
aux4 browser stop > /dev/null 2>&1
sleep 1
aux4 browser open --provider cdp --cdpUrl ws://127.0.0.1:1/devtools --timeout 30s 2>&1
aux4 browser list 2>/dev/null
aux4 browser stop > /dev/null 2>&1
echo done
```

```expect:partial
ECONNREFUSED 127.0.0.1:1
```

```expect:partial
[]
```

### should reattach a cdp:<base64url(wsUrl)> session id from a fresh daemon without any plugin

```execute
aux4 browser stop > /dev/null 2>&1
sleep 1
aux4 browser eval --session cdp:d3M6Ly8xMjcuMC4wLjE6MS9kZXZ0b29scw --script '1' 2>&1
aux4 browser stop > /dev/null 2>&1
echo done
```

```expect:partial
ECONNREFUSED 127.0.0.1:1
```

## presign

### should refuse the local provider

```execute
aux4 browser presign --provider local
```

```error:partial
browser presign: --provider must be a remote provider plugin
```

### should refuse the cdp provider

```execute
aux4 browser presign --provider cdp
```

```error:partial
browser presign: --provider cdp already takes a URL
```
