# ExtensionBridge pairing handshake

Headless coverage of the daemon-side pairing handshake in
`src/daemon/ExtensionBridge.js`. The harness script
(`extension-bridge-handshake.mjs`) starts a real `ExtensionBridge` on an
OS-assigned free port and drives it with a plain `ws` client -- no Chrome,
no daemon process, no `aux4 browser connect`. The bridge and every client
socket live inside that one short-lived node process, so there is nothing
to clean up afterwards.

## headless handshake scenarios

### should enforce the token, protocol version, hello-first rule, and connection replacement

```timeout
15000
```

```execute
node extension-bridge-handshake.mjs
```

```expect
bad-token:pass
version-mismatch:pass
expected-hello:pass
welcome:pass
replace:pass
```
