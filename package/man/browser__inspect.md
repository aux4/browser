#### Description

Print the CDP (Chrome DevTools Protocol) connection handshake for an auditable browser session. This lets an external tool — such as `aux4 lighthouse` — attach to the same authenticated, headless Chromium that the session is driving, instead of launching its own logged-out browser.

The session must have been opened with `aux4 browser open --auditable true`. An auditable session runs as a persistent Chromium context with a remote debugging port, so any tab the external tool opens lands in the same default profile and inherits the session's cookies **and** localStorage.

`inspect` writes exactly one compact JSON object to stdout and nothing else, so it can be piped directly into a downstream consumer:

```json
{"url":"https://app.example.com/dashboard","port":63718}
```

- **`url`** — the current URL of the session's active tab.
- **`port`** — the live remote debugging port. `GET http://127.0.0.1:<port>/json/version` returns the Chrome version handshake, confirming the endpoint is reachable.

If the session was not opened with `--auditable true`, the command fails with: `Session is not auditable. Open it with: aux4 browser open --auditable true`.

#### Usage

```bash
aux4 browser inspect --session <id>
```

    --session  Session ID of an auditable session (required)

#### Example

```bash
SID=$(aux4 browser open --url https://app.example.com/login --auditable true)
# ... log in via type / click ...
aux4 browser inspect --session $SID
```

```json
{"url":"https://app.example.com/dashboard","port":63718}
```

Pipe the handshake into an authenticated Lighthouse audit:

```bash
aux4 browser inspect --session $SID | aux4 lighthouse audit --fromBrowser
```
