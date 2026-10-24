#### Description

Navigate to a URL in the current tab. Returns `{status, httpStatus, finalUrl, title}` for immediate triage.

By default waits for the `load` event. Use `--waitUntil` to control the wait strategy — `networkidle` for SPAs, `settle` for a mutation-observer quiet period.

- **`--url`** is positional — `aux4 browser visit <url>` works without typing `--url`.
- **`--session`** can be omitted. When it is, `visit` uses the most recently used active session instead of
  failing, the same session you'd get by just having run `open` last. If no session is active at all, it errors
  naming the exact command to run (`aux4 browser open --url <url>`) instead of hanging on a prompt or guessing.

#### Usage

```bash
aux4 browser visit [--session <id>] <url> [--waitUntil load]
```

    --session    Session ID; defaults to the most recently used session when omitted
    --url        URL to navigate to (required, positional)
    --waitUntil  Wait strategy: domcontentloaded, load, networkidle, settle. Default: load

#### Example

```bash
# Basic navigation
aux4 browser visit --session abc123 https://example.com/login

# Reusing the last session implicitly
aux4 browser visit https://example.com/login

# Wait for SPA hydration
aux4 browser visit --session abc123 https://app.example.com --waitUntil networkidle
```
