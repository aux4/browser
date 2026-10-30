#### Description

Click an element by role+name or by snapshot ref index.

Two modes:
- **By name** — matches by accessible name and ARIA role. Use `--index` to disambiguate when multiple elements share the same name.
- **By ref** — clicks the element at the given snapshot ref index, bypassing name matching entirely. This is the robust default when accessible names are empty or malformed.

On timeout, returns `{clicked: false, reason: "timeout", description, currentUrl, title}` instead of an error.

Use `--within <iframe-css>` to click inside an iframe. The default main-frame search cannot reach iframe content; `--within` resolves the element inside the frame via Playwright's frameLocator. Nest frames by joining selectors with `>>>`.

#### Usage

```bash
aux4 browser click --session <id> --ref <n>
aux4 browser click --session <id> --name <name> [--role button] [--index <n>] [--within <iframe-css>]
```

    --session   Session ID (required)
    --name      Accessible name of the element
    --role      ARIA role (default: button)
    --index     1-based index when multiple elements match
    --ref       Snapshot ref index (from snapshot command), overrides name/role
    --within    Optional iframe CSS selector to click inside (frameLocator); nest with >>>

#### Example

```bash
# Click by snapshot ref (preferred)
aux4 browser click --session abc123 --ref 6

# Click the "Submit" button by name
aux4 browser click --session abc123 --name "Submit"

# Click the 2nd "Add" button on the page
aux4 browser click --session abc123 --name "Add" --index 2

# Click a link instead of a button
aux4 browser click --session abc123 --name "Learn more" --role link
```
