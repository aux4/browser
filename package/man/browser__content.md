# browser content

Get page content in the specified format. Returns a warning if content is suspiciously short (page may not be fully rendered).

## Usage

```
aux4 browser content --session <id> [--selector <css>] [--format markdown] [--output <path>]
```

## Options

- `--session` — Session ID (required)
- `--selector` — CSS selector for specific element (default: full page)
- `--format` — Output format: markdown, html, text (default: markdown)
- `--output` — Write content to file instead of stdout. Returns `{path, contentLength, headingCount, firstHeading, preview}` for cheap triage
