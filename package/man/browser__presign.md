#### Description

The `presign` command mints a short-lived CDP WebSocket URL for a remote browser session owned by a provider plugin (e.g. `aux4/browser-agentcore`), so that a different process with **no cloud credentials** can attach to it with the built-in `--provider cdp`.

- **New session** — with no `--session`, the provider starts a new remote session (lifetime `--timeout`) and returns its handle.
- **Existing session** — with `--session <provider id>` (e.g. `agentcore:eyJ...`), it mints a fresh URL for that same session, e.g. for the next invocation after the previous URL expired.
- **Expiry** — `--expires` sets how long the URL can be used to connect (the provider maximum applies; AgentCore: 300 seconds). An already-open connection is not cut when the URL expires.

The output is JSON: `session` (the provider handle to keep for re-presign/close), `sessionId`, `cdpUrl` (the presigned URL), `cdpSession` (a ready-to-use `cdp:<base64url(cdpUrl)>` session id that works with every `browser` command), `expiresIn` and `expiresAt`.

The remote session is not stopped by closing a `cdp` session; stop it with `aux4 browser close --session <session>` where the credentials are.

#### Usage

```bash
aux4 browser presign [--provider agentcore] [--session <id>] [--timeout <duration>] [--expires 300] [--awsProfile <profile>] [--awsRegion <region>]
```

--provider    Provider plugin that owns the remote session (default: agentcore)
--session     Existing provider session id to re-presign; empty starts a new session
--timeout     Lifetime of a new remote session (e.g. 15m, 900s); ignored with --session
--expires     URL validity in seconds (default: 300)
--awsProfile  AWS profile, for providers that need AWS credentials
--awsRegion   AWS region, for providers that need one

#### Example

```bash
aux4 browser presign --provider agentcore --timeout 15m --awsProfile my-profile
```

```json
{
  "session": "agentcore:eyJzZXNzaW9uSWQiOiIwMU0z...",
  "sessionId": "01M3AJMW60GPF8XCXV6JCC3K7W",
  "cdpUrl": "wss://bedrock-agentcore.us-east-1.amazonaws.com/browser-streams/aws.browser.v1/sessions/01M3AJMW60GPF8XCXV6JCC3K7W/automation?X-Amz-Algorithm=...",
  "cdpSession": "cdp:d3NzOi8vYmVkcm9jay1hZ2VudGNvcmUu...",
  "expiresIn": 300,
  "expiresAt": "2026-09-24T18:30:00.000Z"
}
```

Then, on a machine without credentials:

```bash
aux4 browser visit --session 'cdp:d3NzOi8vYmVkcm9jay1hZ2VudGNvcmUu...' --url https://example.com
```
