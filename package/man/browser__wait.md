#### Description

Wait for a condition before proceeding. Supports multiple modes beyond CSS selectors.

On timeout, returns `{timedOut: true, waitedFor, timeout, currentUrl, title, visibleHeadings}` instead of an error, so agents can self-correct.

#### Modes

- **CSS selector** — wait for an element to become visible: `--selector ".my-element"`
- **text=...** — wait for text to appear on the page: `--selector "text=Welcome"`
- **url=...** — wait for URL to match a pattern: `--selector "url=/dashboard"`
- **networkidle** — wait for network to go idle: `--selector networkidle`
- **settle** — wait for DOM mutations to stop (300ms quiet period): `--selector settle`

#### Usage

```bash
aux4 browser wait --session <id> --selector <target> [--timeout 10000]
```

    --session   Session ID (required)
    --selector  Wait target: CSS selector, text=..., url=..., networkidle, or settle (required)
    --timeout   Timeout in milliseconds. Default: 10000

#### Example

```bash
# Wait for a CSS selector
aux4 browser wait --session abc123 --selector ".results-loaded"

# Wait for text to appear
aux4 browser wait --session abc123 --selector "text=Search results"

# Wait for URL change
aux4 browser wait --session abc123 --selector "url=/dashboard"

# Wait for network idle (useful after form submission)
aux4 browser wait --session abc123 --selector networkidle

# Wait for DOM to settle (useful for SPAs)
aux4 browser wait --session abc123 --selector settle
```
