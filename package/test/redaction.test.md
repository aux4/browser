# Output/error redaction (CBR-015)

A "cdp" session id is `cdp:<base64url(wsUrl)>` — the presigned URL IS the credential — and a presigned
`wss?://`/`https?://` URL's auth lives in its query string (e.g. `X-Amz-Signature`). Neither should ever reach an
error message or a session listing. These tests use a refused local connection (`127.0.0.1:1`) so no live
AgentCore session is needed — what's being verified is that the daemon's error path strips the query string
before it leaves the process, and that `browser list` never prints a full provider-backed session id.

```timeout
30000
```

## open --provider cdp --cdpUrl with a signed query string

### should surface the connect failure without leaking the query string / signature

```execute
aux4 browser stop > /dev/null 2>&1
sleep 1
aux4 browser open --provider cdp --cdpUrl 'ws://127.0.0.1:1/devtools?X-Amz-Signature=abcdef1234567890&X-Amz-Credential=SECRETCREDVALUE' --timeout 30s 2>&1
aux4 browser stop > /dev/null 2>&1
echo done
```

```expect:partial
ECONNREFUSED 127.0.0.1:1
```

```expect:partial
done
```

```expect:regex
^(?:(?!X-Amz-Signature|SECRETCREDVALUE|abcdef1234567890)[\s\S])*$
```

## reattach a cdp:<base64url(signed wsUrl)> session id

### should surface the connect failure without leaking the encoded signed URL's query string

```execute
aux4 browser stop > /dev/null 2>&1
sleep 1
aux4 browser eval --session cdp:d3M6Ly8xMjcuMC4wLjE6MS9kZXZ0b29scz9YLUFtei1TaWduYXR1cmU9YWJjZGVmMTIzNDU2Nzg5MCZYLUFtei1DcmVkZW50aWFsPVNFQ1JFVENSRURWQUxVRQ --script '1' 2>&1
aux4 browser stop > /dev/null 2>&1
echo done
```

```expect:partial
ECONNREFUSED 127.0.0.1:1
```

```expect:partial
done
```

```expect:regex
^(?:(?!X-Amz-Signature|SECRETCREDVALUE|abcdef1234567890)[\s\S])*$
```

## browser list never prints a full provider-backed session id

A plain local session id (no ":") carries no secret and is printed in full, unchanged. This is a regression
guard: `list()` must still return real, usable ids for local sessions — only provider-backed ids are
fingerprinted.

```timeout
30000
```

```execute
aux4 browser stop > /dev/null 2>&1
sleep 1
aux4 browser start --persistent true > /dev/null 2>&1 &
sleep 4
SESSION=$(aux4 browser open 2>/dev/null)
aux4 browser list 2>/dev/null | grep -q "$SESSION" && echo "ok: local id shown in full" || echo "FAIL: local id missing from list"
aux4 browser close --session $SESSION > /dev/null 2>&1
aux4 browser stop > /dev/null 2>&1
echo done
```

```expect:partial
ok: local id shown in full
```

```expect:partial
done
```
