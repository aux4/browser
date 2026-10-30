# browser type

Type text into an input field by accessible name and ARIA role.

Use `--within <iframe-css>` to type into a field inside an iframe (frameLocator); the default main-frame search cannot reach iframe content. Nest frames by joining selectors with `>>>`.

## Usage

```
aux4 browser type --session <id> --name <name> --value <text> [--role textbox] [--within <iframe-css>]
```

## Options

- `--session` — Session ID (required)
- `--name` — Accessible name of the field (required)
- `--value` — Text to type (required)
- `--role` — ARIA role (default: textbox)
- `--within` — Optional iframe CSS selector to scope into (frameLocator); nest with `>>>`
