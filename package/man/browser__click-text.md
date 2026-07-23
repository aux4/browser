#### Description

Click an element by its visible text content. Uses loose matching (substring, case-insensitive).

By default clicks the first match. When multiple elements contain the same text, use `--index` to pick a specific one (1-based).

Use `--within <iframe-css>` to match text inside an iframe (frameLocator); the default main-frame search cannot reach iframe content. Nest frames by joining selectors with `>>>`.

#### Usage

```bash
aux4 browser click-text --session <id> --text <text> [--index <n>] [--within <iframe-css>]
```

    --session   Session ID (required)
    --text      Text content to find and click (required)
    --index     1-based index when multiple elements match
    --within    Optional iframe CSS selector to click inside (frameLocator); nest with >>>

#### Example

```bash
# Click the first element containing "Learn more"
aux4 browser click-text --session abc123 --text "Learn more"

# Click the 3rd "Learn more" on the page
aux4 browser click-text --session abc123 --text "Learn more" --index 3
```
