#### Description

Navigate to a URL in the current tab. Returns `{status, httpStatus, finalUrl, title}` for immediate triage.

By default waits for the `load` event. Use `--waitUntil` to control the wait strategy — `networkidle` for SPAs, `settle` for a mutation-observer quiet period.

#### Usage

```bash
aux4 browser visit --session <id> --url <url> [--waitUntil load]
```

    --session    Session ID (required)
    --url        URL to navigate to (required)
    --waitUntil  Wait strategy: domcontentloaded, load, networkidle, settle. Default: load

#### Example

```bash
# Basic navigation
aux4 browser visit --session abc123 --url https://example.com/login

# Wait for SPA hydration
aux4 browser visit --session abc123 --url https://app.example.com --waitUntil networkidle
```
