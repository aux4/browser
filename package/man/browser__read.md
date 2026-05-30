#### Description

One-shot page read: opens a session (or reuses an existing one), navigates to the URL, waits for the page to settle, and returns content + status in a single call.

When no `--session` is provided, creates a temporary session that is automatically closed after the read. When a session is provided, it is reused and kept open.

#### Usage

```bash
aux4 browser read --url <url> [--format markdown] [--waitUntil load] [--session <id>] [--output <path>]
```

    --url        URL to read (required)
    --format     Content format: markdown, html, text. Default: markdown
    --waitUntil  Navigation wait strategy: domcontentloaded, load, networkidle, settle. Default: load
    --session    Existing session ID to reuse (optional)
    --output     Write content to file instead of inline. Returns {path, contentLength, headingCount, firstHeading, preview}

#### Example

```bash
# One-shot read (creates and closes a temporary session)
aux4 browser read --url https://example.com

# Read to disk for token-efficient agent use
aux4 browser read --url https://example.com --output /tmp/page.md

# Reuse an existing session
aux4 browser read --url https://example.com/docs --session abc123
```
