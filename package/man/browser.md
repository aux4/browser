#### Description

Headless browser automation with daemon architecture and multi-agent session management.

Every command below that takes `--session` can omit it: when omitted, it falls back to the only open session,
or the most recently opened/used one if several are open — the same session `open` just returned. If no session
is open at all, the command errors naming the exact command to run (`aux4 browser open --url <url>`) instead of
hanging on an interactive prompt or failing with an opaque "value of session" error.

#### Usage

```bash
aux4 browser <command> [options]
```

#### Commands

**Lifecycle:**

- `start` — Start the browser daemon
- `stop` — Stop the browser daemon
- `open` — Open a new browser session
- `close` — Close a browser session
- `list` — List active sessions

**Navigation:**

- `visit` — Navigate to a URL
- `back` — Go back in history
- `forward` — Go forward in history
- `reload` — Reload the page

**Interaction:**

- `fill` — Fill one form field (or a JSON map of fields) by its visible label — **the usual way to fill a form**
- `click` — Click an element by role and accessible name
- `click-text` — Click an element by text content
- `click-selector` — Click an element by CSS selector
- `click-item` — Click a list item by text or index
- `type` — Type into an input field
- `select` — Select a dropdown option
- `check` — Check a checkbox
- `uncheck` — Uncheck a checkbox
- `hover` — Hover over an element
- `press` — Press a keyboard key
- `clear` — Clear an input field
- `upload` — Upload a file
- `scroll` — Scroll the page or scroll to an element

**Content & Inspection:**

- `content` — Get page content as markdown, HTML, or text
- `screenshot` — Take a screenshot
- `snapshot` — Get an accessibility snapshot of the page
- `blocks` — Split the page into content blocks (headings, paragraphs, cards, table rows) via a deterministic DOM walk
- `component` — Interact with a UI component *structurally* (table, list, nav, menu, dialog, tab, tree, card). To fill a single form field, use `fill` instead of `component --type form --action fill`

**Assertions:**

- `wait` — Wait for a selector to appear
- `expect` — Assert on page elements
- `expect-list` — Assert on lists
- `get-items` — Get list item texts

**Session Control:**

- `set-scope` — Restrict commands to a DOM subtree
- `clear-scope` — Clear the scope restriction
- `set-snapshot` — Toggle auto-snapshot mode on actions

**Tabs:**

- `new-tab` — Open a new tab
- `switch-tab` — Switch to a tab
- `close-tab` — Close a tab
- `list-tabs` — List tabs

**Advanced:**

- `eval` — Evaluate JavaScript in the page
- `cookies` — Manage cookies
- `download` — Download a file
- `save-pdf` — Save page as PDF
- `execute` — Execute batch instructions
- `run` — One-shot mode (launch, execute, exit)
- `mcp` — Start MCP server mode
