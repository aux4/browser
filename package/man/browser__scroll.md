#### Description

Scroll the page by direction and amount, or scroll a specific element into view by text content.

- **`--direction`** — Scroll direction: `up`, `down`, `top`, `bottom` (default: `down`).
- **`--amount`** — Scroll distance in pixels (default: 500). Only used with `up`/`down`.
- **`--to`** — Scroll an element into view by its text content. When provided, `--direction` and `--amount` are ignored.

#### Usage

```bash
aux4 browser scroll --session <id> [--direction down] [--amount 500] [--to <text>]
```

    --session     Session ID (required)
    --direction   Scroll direction: up, down, top, bottom (default: down)
    --amount      Scroll amount in pixels (default: 500)
    --to          Scroll to element by text content

#### Example

```bash
# Scroll down 500px
aux4 browser scroll --session abc123 --direction down

# Scroll to top of page
aux4 browser scroll --session abc123 --direction top

# Scroll "Product Details" section into view
aux4 browser scroll --session abc123 --to "Product Details"
```
