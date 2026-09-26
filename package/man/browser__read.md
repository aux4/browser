#### Description

One-shot page read: opens a session (or reuses an existing one), navigates to the URL, waits for the page to settle, and returns content + status in a single call.

When no `--session` is provided, creates a temporary session that is automatically closed after the read. When a session is provided, it is reused and kept open.

The `markdown` and `text` formats return only readable page text:

- **No code or data** — `<script>`, `<style>`, `<noscript>`, `<template>`, `<iframe>` and `<svg>` content, JSON-LD and embedded JSON data blobs are dropped (the same skip rules as `browser blocks`)
- **Main content first** — when the page has a main landmark (`<main>` or `role="main"`), its content comes first, then a `---` line, then the rest of the page (header, navigation, footer)
- **Links kept** — links that span several lines still come out as `[label](href)`
- **Web components** — text inside open shadow roots is included where it renders
- **Frames** — the readable text of every visible child frame (at least 100x50 px; tracking pixels and hidden frames are skipped) follows the page's own content after a `---` line
- **Rendered content** — after navigating, the read waits up to 8 seconds (`AUX4_BROWSER_CONTENT_WAIT` ms on the daemon, `0` disables) for a single-page app to show rendered text; a static page with no scripts returns immediately

The `html` format returns the raw HTML unchanged.

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
