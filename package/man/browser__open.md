#### Description

Open a new browser session. Returns a session ID for subsequent commands.

Each session is an isolated Playwright BrowserContext with its own cookies, storage, and tabs.

- **`--snapshot`** — Enable auto-snapshots on actions. When set to `auto` or `full`, every action (click, visit, scroll, etc.) returns an accessibility snapshot in the response. Can be changed later with `set-snapshot`.
- **`--video`** — Record video of the session. `retain-on-failure` only keeps the video if an error occurred.
- **`--output`** — Directory for saving artifacts (screenshots, videos). Required for `--video`.
- **`--provider`** — Where the browser actually runs. `local` (default) launches/reuses a browser on this machine, same as before. Any other value (e.g. `agentcore`) is a provider name implemented by a separately-installed plugin package (e.g. `aux4/browser-agentcore`) that hands back a remote `wsUrl`/headers for aux4/browser to attach Playwright to over CDP instead of launching locally. Core has no built-in knowledge of any provider beyond the name — if the matching plugin isn't installed, `open` fails with a clear "provider ... is unavailable" error; it never silently falls back to a local browser. The returned `--session` id (e.g. `agentcore:eyJ...`) works with every other `browser` command exactly like a local one, and also survives the local daemon restarting or a brand new process using it (the daemon transparently reattaches to the provider session the first time it sees the id) — see `browser close`.
- **`--provider cdp` / `--cdpUrl`** — Built in, no plugin: attach directly to the CDP WebSocket URL in `--cdpUrl` (`ws://` or `wss://`, e.g. a presigned URL from `browser presign`). No credentials are needed in this process. The returned id is `cdp:<base64url(url)>`, usable from any fresh process; `close` on it only disconnects (the remote session is owned by whoever minted the URL).
- **User agent** — every session presents a regular Chrome user agent (with matching client hints): `HeadlessChrome` becomes `Chrome`, and a remote provider's automation token (e.g. AgentCore's `Amazon-Bedrock-AgentCore-Browser/1.0 (...)`) is removed. Set `AUX4_BROWSER_USER_AGENT=keep` in the daemon's environment to keep the browser's own user agent, or to any other value to use that exact string.
- **`--awsProfile` / `--awsRegion`** — Forwarded as-is to the selected provider when it needs AWS credentials/region (e.g. `agentcore`); ignored for `--provider local`.

#### Usage

```bash
aux4 browser open [--url <url>] [--timeout 10m] [--width 1280] [--height 720] [--output <dir>] [--video off] [--snapshot off] [--waitUntil load] [--provider local] [--awsProfile <profile>] [--awsRegion <region>] [--cdpUrl <ws-url>]
```

    --url         URL to navigate to
    --timeout     Session idle timeout (e.g. 10m, 1h). Default: 10m
    --width       Viewport width (--provider local only). Default: 1280
    --height      Viewport height (--provider local only). Default: 720
    --output      Directory to save artifacts (screenshots, videos)
    --video       Video recording mode: on, off, retain-on-failure. Default: off
    --snapshot    Auto-snapshot mode: off, auto, full. Default: off
    --waitUntil   Navigation wait strategy: domcontentloaded, load, networkidle, settle. Default: load
    --provider    Where to run the browser: local (default) or a provider name from an installed plugin (e.g. agentcore)
    --awsProfile  AWS profile, forwarded to providers that need AWS credentials (e.g. agentcore)
    --awsRegion   AWS region, forwarded to providers that need one (e.g. agentcore)
    --cdpUrl      CDP WebSocket URL to attach to when --provider cdp

#### Example

```bash
# Basic session
aux4 browser open --url https://example.com

# Session with auto-snapshots for AI agent use
aux4 browser open --url https://example.com --snapshot auto

# Session with video recording
aux4 browser open --url https://example.com --output ./artifacts --video retain-on-failure

# Session on a remote Amazon Bedrock AgentCore Browser (requires aux4/browser-agentcore)
aux4 browser open --provider agentcore --awsProfile my-profile --awsRegion us-east-1

# Attach to a remote browser by URL only (e.g. a presigned URL from `browser presign`)
aux4 browser open --provider cdp --cdpUrl 'wss://example.com/devtools/browser/abc'
```
