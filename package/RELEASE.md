# Release notes

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
