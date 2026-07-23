#### Description

Drive the **real mouse** via the browser's input pipeline at viewport coordinates, moving the cursor through a human-like multi-step trajectory.

Unlike `click`/`click-selector`, which resolve an element and teleport the cursor straight to it, `mouse` targets raw page-space `x,y` coordinates and glides there over `--steps` intermediate moves. This produces natural cursor motion for sites that score pointer behavior, and works regardless of iframes (it clicks whatever is at the coordinate). Combine a `move` to one point with a `click` at another to simulate a real approach-then-click.

Instead of raw `x,y`, pass `--selector` (optionally with `--within` for an iframe) to aim at the **center of an element** — the command resolves the element's page-space box and moves/clicks there. This is the convenient way to mouse-click a specific element with human-like motion.

**Note:** When targeting by id from a **playbook** action (`click mouse on "..."`), use the attribute form `[id="submit"]` rather than `#submit` — the playbook engine treats `#` as a comment and would strip it. From the shell `--selector "#submit"` is fine.

Actions:

- **`move`** — glide the cursor to the target over `--steps` moves (no button press)
- **`click`** — glide to the target, then press and release the left button
- **`down`** / **`up`** — press / release the left button at the current position

#### Usage

```bash
aux4 browser mouse --session <id> [--action move|click|down|up] --x <px> --y <px> [--steps 20]
aux4 browser mouse --session <id> [--action click] --selector <css> [--within <iframe-css>] [--steps 20]
```

    --session   Session ID (required)
    --action    move | click | down | up (default: click)
    --x         Target viewport X coordinate (ignored when --selector is given)
    --y         Target viewport Y coordinate (ignored when --selector is given)
    --steps     Number of intermediate move steps (default: 20)
    --selector  CSS selector to aim at the element's center instead of x/y
    --within    iframe CSS selector to resolve --selector inside (frameLocator)

#### Example

```bash
# Drift the cursor toward a point, then click another point
aux4 browser mouse --session abc123 --action move --x 120 --y 300 --steps 25
aux4 browser mouse --session abc123 --action click --x 240 --y 360 --steps 18

# Mouse-click an element by selector (human-like movement), even inside an iframe
aux4 browser mouse --session abc123 --action click --selector "#submit" --within "iframe#checkout"
```

```text
{"status":"ok","action":"click","x":240,"y":360}
```
