#### Description

Click an element by CSS selector. Clicks the first match.

Use this as a fallback when accessible name or text content matching is not sufficient.

#### Usage

```bash
aux4 browser click-selector --session <id> --selector <css>
```

    --session    Session ID (required)
    --selector   CSS selector to click (required)

#### Example

```bash
aux4 browser click-selector --session abc123 --selector ".nav > a:first-child"
```
