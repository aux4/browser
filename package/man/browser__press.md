#### Description

Press a keyboard key. Optionally focus an element by CSS selector before pressing.

Without `--selector`, the key is sent to whatever element currently has focus (or the page). Use `--selector` when focus isn't on the intended element — for example, pressing arrow keys on a carousel or overlay.

Common keys: `Enter`, `Tab`, `Escape`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Backspace`, `Delete`, `Space`.

#### Usage

```bash
aux4 browser press --session <id> --key <key> [--selector <css>]
```

    --session    Session ID (required)
    --key        Key to press (required)
    --selector   CSS selector to focus before pressing

#### Example

```bash
# Press Enter
aux4 browser press --session abc123 --key Enter

# Focus a carousel overlay, then press ArrowRight
aux4 browser press --session abc123 --key ArrowRight --selector ".carousel-overlay"

# Press Escape to close a dialog
aux4 browser press --session abc123 --key Escape
```
