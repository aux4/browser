#### Description

Return an accessibility snapshot of the current page. The snapshot lists interactive elements (buttons, links, inputs) and structural components (tables, forms, lists, navs) with their accessible names, ARIA roles, and bounding boxes.

This is the recommended way for AI agents to understand page state without taking screenshots.

- **`--mode auto`** — Returns up to ~50 interactive elements and all components. Good for most pages.
- **`--mode full`** — Returns all elements including text nodes. Use for complex pages where auto truncates too much.
- **`--format json`** — Returns structured JSON (default).
- **`--format text`** — Returns a human-readable text rendering of the snapshot.

Each element has a `ref` number stable within the snapshot. Use `browser click --ref <n>` to click elements by their snapshot ref.

#### Usage

```bash
aux4 browser snapshot --session <id> [--mode auto] [--format json] [--output <path>]
```

    --session   Session ID (required)
    --mode      Snapshot mode: auto, full (default: auto)
    --format    Output format: json, text (default: json)
    --output    Write snapshot to file. Returns {path, title, elementCount, componentCount} for cheap triage

#### Example

```bash
# Get accessibility snapshot
aux4 browser snapshot --session abc123

# Get full snapshot in text format
aux4 browser snapshot --session abc123 --mode full --format text
```

```text
# Example Page
https://example.com

## Components
  [1] form "Login" fields: Email, Password
  [2] nav "Main Navigation"

## Elements
  [3] textbox "Email"
  [4] textbox "Password"
  [5] button "Sign In"
  [6] link "Forgot Password"
```
