# browser content

Get page content in the specified format. Returns a warning if content is suspiciously short (page may not be fully rendered).

Before extracting, waits for the page to settle — no in-flight network requests AND no DOM mutations for 500ms,
bounded by `--wait` (default 5000ms, or `AUX4_BROWSER_SETTLE_WAIT` on the daemon) — so content that finishes
loading after the page already shows some placeholder text (a delayed `fetch`, an htmx `hx-get`/`hx-trigger="load"`,
any async render) is captured instead of the placeholder. A page that is already settled returns almost
immediately.

## Usage

```
aux4 browser content --session <id> [--selector <css>] [--format markdown] [--output <path>] [--wait <ms>]
```

## Options

- `--session` — Session ID; defaults to the most recently used open session when omitted
- `--selector` — CSS selector for specific element (default: full page)
- `--format` — Output format: markdown, html, text (default: markdown)
- `--output` — Write content to file instead of stdout. Returns `{path, contentLength, headingCount, firstHeading, preview}` for cheap triage
- `--wait` — Max time to wait for the page to settle before returning, in ms (default: 5000, or `AUX4_BROWSER_SETTLE_WAIT`)
