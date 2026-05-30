#### Description

Set the auto-snapshot mode for a session. When enabled, every action (click, visit, scroll, type, etc.) automatically includes an accessibility snapshot in its response, so agents can see the page state without making an extra call.

- **`off`** — No snapshots attached to action responses (default).
- **`auto`** — Attach a snapshot with up to ~50 interactive elements after each action.
- **`full`** — Attach a complete snapshot (all elements including text nodes) after each action.

The snapshot mode can also be set at session open time via `aux4 browser open --snapshot auto`.

#### Usage

```bash
aux4 browser set-snapshot --session <id> --mode <off|auto|full>
```

    --session   Session ID (required)
    --mode      Snapshot mode: off, auto, full (required)

#### Example

```bash
# Enable auto-snapshots for debugging
aux4 browser set-snapshot --session abc123 --mode auto

# Now every action returns page state
aux4 browser click --session abc123 --name "Submit"
# Response includes { status: "ok", snapshot: { ... } }

# Disable when done
aux4 browser set-snapshot --session abc123 --mode off
```
