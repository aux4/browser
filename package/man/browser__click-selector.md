#### Description

Click an element by CSS selector. Clicks the first match.

Use this as a fallback when accessible name or text content matching is not sufficient.

- **`--within`** — scope the click **inside an iframe** identified by a CSS selector. By default `click-selector` searches the main frame only and cannot reach content rendered inside an iframe (the click times out). With `--within`, the selector is resolved inside the frame using Playwright's frameLocator, which reaches the frame's document and dispatches a real, auto-waited click. Nest multiple frames by joining their selectors with `>>>` (e.g. `--within "iframe.outer >>> iframe.inner"`).

#### Usage

```bash
aux4 browser click-selector --session <id> --selector <css> [--within <iframe-css>]
```

    --session    Session ID (required)
    --selector   CSS selector to click (required)
    --within     Optional iframe CSS selector to click inside (frameLocator); nest frames with >>>

#### Example

```bash
aux4 browser click-selector --session abc123 --selector ".nav > a:first-child"
```

Click a button that lives inside an iframe:

```bash
aux4 browser click-selector --session abc123 --selector "#submit" --within "iframe#checkout"
```

```text
{"status":"ok"}
```
