#### Description

Type text into an input field by accessible name and ARIA role, or by snapshot ref index.

Two modes:
- **By name** — matches by accessible name and ARIA role.
- **By ref** — fills the element at the given snapshot ref index, bypassing name matching entirely. `--name` is not required when `--ref` is given. This is the robust default when accessible names are empty or malformed.

Use `--within <iframe-css>` to type into a field inside an iframe (frameLocator); the default main-frame search cannot reach iframe content. Nest frames by joining selectors with `>>>`.

#### Usage

```bash
aux4 browser type --session <id> --ref <n> --value <text>
aux4 browser type --session <id> --name <name> --value <text> [--role textbox] [--within <iframe-css>]
```

    --session   Session ID (required)
    --name      Accessible name of the field (omit when using --ref)
    --value     Text to type or secret:// reference (required)
    --role      ARIA role (default: textbox)
    --within    Optional iframe CSS selector to scope into (frameLocator); nest with >>>
    --ref       Snapshot ref index (from snapshot command), overrides name/role

#### Example

```bash
# Type by snapshot ref (preferred)
aux4 browser type --session abc123 --ref 6 --value "jane@example.com"

# Type into a field named "Email" by accessible name
aux4 browser type --session abc123 --name "Email" --value "jane@example.com"

# Type into a field inside an iframe
aux4 browser type --session abc123 --name "Email" --value "jane@example.com" --within "iframe#checkout"
```
