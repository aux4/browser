# browser type

Type text into an input field by accessible name and ARIA role.

Use `--selector <css>` to address the field by CSS selector instead (it reaches fields inside open shadow roots); `select`, `check` and `uncheck` take `--selector` too.

Use `--within <iframe-css>` to type into a field inside an iframe (frameLocator); the default main-frame search cannot reach iframe content. Nest frames by joining selectors with `>>>`.

Before reporting the result, waits for the page to settle — no in-flight network requests AND no DOM mutations
for 500ms, bounded by `--wait` (default 5000ms, or `AUX4_BROWSER_SETTLE_WAIT` on the daemon) — so an async
validation message triggered by typing is reflected in the returned `url`/`title`/`errors`.

A field that cannot be matched by `--name`/`--role` always errors — it also lists the labels/fields and
buttons actually on the page (or says there are none), plus the current url/title, so a wrong guess can
self-correct instead of repeating.

## Usage

```
aux4 browser type --session <id> --name <name> --value <text> [--role textbox] [--within <iframe-css>] [--timeout 5000] [--wait <ms>]
aux4 browser type --session <id> --selector <css> --value <text> [--within <iframe-css>] [--wait <ms>]
```

## Options

- `--session` — Session ID; defaults to the most recently used open session when omitted
- `--name` — Accessible name of the field (required)
- `--value` — Text to type (required)
- `--role` — ARIA role (default: textbox)
- `--within` — Optional iframe CSS selector to scope into (frameLocator); nest with `>>>`
- `--selector` — CSS selector of the field (pierces open shadow roots); overrides `--name`/`--role`/`--ref`
- `--timeout` — Timeout in milliseconds for matching the field by `--name`/`--role` (default: 5000)
- `--wait` — Max time to wait for the page to settle before returning, in ms (default: 5000, or `AUX4_BROWSER_SETTLE_WAIT`)
