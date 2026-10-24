# Release notes

## 1.0.34

Agent-ergonomics follow-up (BRW-009), from real agent transcripts driving the browser through `executeAux4`:

- `open` and `visit` take `--url` as a positional argument (`aux4 browser open <url>`, `aux4 browser visit <url>`),
  matching what an agent naturally types instead of only accepting `--url`/`--session --url`.
- `visit` no longer requires `--session`: when omitted it falls back to the most recently used active session;
  with no active session at all it errors naming the exact command to run (`aux4 browser open --url <url>`)
  instead of hanging on an interactive prompt.
- New top-level `fill` command: fills one field by its visible label (`--field`/`--value`) or several at once
  (`--fields <json map>`), sharing the `component fill` dispatch logic (text/select/checkbox/radio) and the
  after-action `{status,url,title,errors}` reporting every write command already returns.
- `component --type <field-level-type>` (e.g. `input`, `button`) now errors naming the exact command to use
  instead (`aux4 browser fill`/`type`/`select`/`click`), since `component` is for structural containers (table,
  form, list, nav, menu, dialog, tab, tree, card), not individual fields.
- `--help` lists the everyday commands first in the `browser` group: `start`, `stop`, `open`, `actions`, `fill`,
  `type`, `select`, `check`, `uncheck`, `click`, `read`, `content`, `snapshot`, then the rest.
- The `mock-open`/`mock-attach`/`mock-close`/`broken-open` test fixtures used to exercise the provider seam
  (CBR-008) without a real cloud provider are no longer part of the published command surface — they moved from
  `package/.aux4` into a `file:.aux4` block materialized only while `provider-seam.test.md` runs, so an installed
  `aux4/browser` never lists them and the package tree never has a second `.aux4` for `pkger build` to trip on.

## 1.0.32

Integration build (CBR-052 line + BRW-008): combines the `actions`/`blocks`/`component`
feature line with the `component fill` fix, plus an agent-friendliness pass —
every command carries a one-line `--help` description, `actions` output states
exact how-to-act commands per control, and action commands report the resulting
URL/title and any visible validation/error text after acting.

## 1.0.31

Fix `component fill` silently doing nothing (BRW-008). `component`'s `action`
variable had no `arg: true`, so the natural `aux4 browser component fill ...`
syntax dropped the word `fill` entirely, left `action` at its `locate`
default, and returned a convincing `{"status":"ok","count":1,"bounds":{...}}`
without ever writing a value. `action` is now a positional argument, so both
`component fill ...` and `component --action fill ...` work.

`fill` now dispatches per matched element instead of calling `.fill()`
unconditionally: text/email/date/textarea inputs still use `fill()`, `<select>`
uses `selectOption()` (by option label, falling back to value), and
checkboxes/radios use `check()`/`uncheck()` based on a truthy `--value`. A
field that cannot be matched (via `--field` or a key in `--fields`) now always
throws a named error (`component fill: field "X" not found`) instead of
silently resolving as `ok` with `count: 0`.

## 1.0.30

- New `actions` command: every control a person could use on the page (fields, buttons, links, options, clickable elements with no role such as suggestion items and cards), in open shadow roots and visible iframes, with label, value, context (dialog/landmark, heading path), the snapshot `ref` when it has one and an exact `selector` (+ `within`). `--includeNav`, `--within`, `--page`.
- `type`, `select`, `check` and `uncheck` accept `--selector <css>` (reaches elements inside open shadow roots) and `--within <iframe-css>`, so an element found by a page script can be acted on exactly.
- `eval --within <iframe-css>` runs the script inside a frame's document (cross-origin frames included; nest with `>>>`).

## 1.0.29

- The user-agent override keeps client hints: `Sec-CH-UA` headers and `navigator.userAgentData` match the user agent (a bare override dropped them, which bot protection reads as automation). Headless brands are reported as `Chromium`.
- `open --url`, `visit` and `read` report `blocked` (`status`, `requests`, `vendor`, `message`) when the site's own requests were refused with HTTP 403/429 and the page shows no text; `read`'s `warning` says the site's bot protection kept the page from rendering.

## 1.0.28

- Sessions present a regular Chrome user agent: `HeadlessChrome` becomes `Chrome` and a remote provider's automation token (e.g. `Amazon-Bedrock-AgentCore-Browser/1.0 (...)`) is removed. Fixes single-page apps behind bot management rendering an empty page (their API calls were blocked). `AUX4_BROWSER_USER_AGENT=keep` restores the old behavior; any other value is used as the exact user agent.
- Navigations wait (up to 8s, `AUX4_BROWSER_CONTENT_WAIT`) for the page to show rendered text before returning, so `read`/`blocks`/`snapshot` don't capture a still-empty single-page app.
- `read`, `content`, `blocks` and `snapshot` see web components: open shadow roots are walked (with refs for their elements). `read`/`content`/`blocks` include the content of visible child frames; `snapshot` lists visible frames with a `--within` selector.

## 1.0.27

- `read` / `content` (markdown, text): readable text only. Script, style, noscript, template, iframe and svg content, JSON-LD and embedded JSON data blobs are dropped; a page's main landmark comes first, then `---` and the rest of the page. Multi-line links keep their `[label](href)`.
- `select`: works on custom comboboxes (`role="combobox"` widgets) by opening them and clicking the matching `role="option"`; a clear `no option matching "<value>"` error otherwise.
