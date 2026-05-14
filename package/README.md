# aux4/browser

Headless browser automation with daemon architecture and multi-agent session management.

## Installation

```bash
aux4 aux4 pkger install aux4/browser
npx playwright install chromium
```

## Architecture

```text
CLI (thin client) ──Unix Socket──> Daemon (Node.js)
                                    ├── SessionManager
                                    │   ├── Session A (BrowserContext)
                                    │   ├── Session B (BrowserContext)
                                    │   └── Session C (BrowserContext)
                                    └── BrowserEngine (Playwright Chromium)
```

Each session is an isolated Playwright BrowserContext with its own cookies, storage, and tabs. Multiple agents can interact with different sessions simultaneously without interference.

## Usage

### Lifecycle

```bash
# Start the daemon
aux4 browser start

# Open a session
aux4 browser open --url https://example.com --timeout 10m

# List active sessions
aux4 browser list

# Close a session
aux4 browser close --session <id>

# Stop the daemon
aux4 browser stop
```

### Navigation

```bash
aux4 browser visit --session <id> --url https://example.com
aux4 browser back --session <id>
aux4 browser forward --session <id>
aux4 browser reload --session <id>
```

Pages load using the `domcontentloaded` strategy, which considers navigation complete once the HTML is fully parsed. This is faster than waiting for all network requests to finish, making page transitions more responsive.

### Interaction

```bash
# Click a button (default role: button)
aux4 browser click --session <id> --name "Submit"

# Click the 2nd match when multiple elements share the same name
aux4 browser click --session <id> --name "Add" --index 2

# Click by text content
aux4 browser click-text --session <id> --text "Learn more"

# Click the 3rd "Learn more" link
aux4 browser click-text --session <id> --text "Learn more" --index 3

# Click by CSS selector
aux4 browser click-selector --session <id> --selector ".nav > a:first-child"

# Click a list item by text or 1-based index
aux4 browser click-item --session <id> --item "Settings"
aux4 browser click-item --session <id> --item 2

# Type into an input (default role: textbox)
aux4 browser type --session <id> --name "Email" --value "user@test.com"

# Select a dropdown option
aux4 browser select --session <id> --name "Country" --value "US"

# Check / uncheck a checkbox
aux4 browser check --session <id> --name "I agree"
aux4 browser uncheck --session <id> --name "I agree"

# Hover over an element
aux4 browser hover --session <id> --name "Menu" --role link

# Clear an input field
aux4 browser clear --session <id> --name "Search"

# Upload a file
aux4 browser upload --session <id> --name "Avatar" --file photo.jpg
```

### Scrolling

```bash
# Scroll down (default: 500px)
aux4 browser scroll --session <id> --direction down --amount 500

# Scroll to top or bottom
aux4 browser scroll --session <id> --direction top
aux4 browser scroll --session <id> --direction bottom

# Scroll to an element by its text content
aux4 browser scroll --session <id> --to "Product Details"
```

### Keyboard

```bash
# Press a key
aux4 browser press --session <id> --key Enter

# Focus an element first, then press a key
aux4 browser press --session <id> --key ArrowRight --selector ".carousel"
```

### Content

```bash
# Get page content as markdown (default)
aux4 browser content --session <id>

# Get specific element as text
aux4 browser content --session <id> --selector ".main" --format text

# Take a screenshot
aux4 browser screenshot --session <id> --output page.png --fullPage true
```

### Accessibility Snapshots

Snapshots return a lightweight accessibility tree of the page, listing interactive elements (buttons, links, inputs) and components (tables, forms, lists, navs). This is the recommended way for AI agents to understand page state without screenshots.

```bash
# Get a snapshot (auto mode: ~50 elements)
aux4 browser snapshot --session <id>

# Full snapshot (all elements including text nodes)
aux4 browser snapshot --session <id> --mode full

# Text format for readability
aux4 browser snapshot --session <id> --format text
```

#### Auto-Snapshot on Actions

Enable auto-snapshot to receive page state after every action (click, visit, scroll, type, etc.) without extra commands:

```bash
# Enable at session open
aux4 browser open --url https://example.com --snapshot auto

# Toggle mid-session
aux4 browser set-snapshot --session <id> --mode auto

# Disable when no longer needed
aux4 browser set-snapshot --session <id> --mode off
```

Modes: `off` (default), `auto` (~50 elements), `full` (all elements).

### Scoping

Restrict commands to a subtree of the DOM:

```bash
aux4 browser set-scope --session <id> --selector ".sidebar"
# Now click, type, etc. only target elements within .sidebar
aux4 browser click --session <id> --name "Settings"
aux4 browser clear-scope --session <id>
```

Scopes nest — setting a new scope pushes the previous one onto a stack, and clearing pops it.

### Components

Interact with structured UI elements at a higher level:

```bash
# Read a table
aux4 browser component --session <id> --type table --action read

# Click a specific table cell
aux4 browser component --session <id> --type table --action click --row 2 --col "Name"

# Fill a form
aux4 browser component --session <id> --type form --action fill --fields '{"Email":"user@test.com","Password":"secret"}'

# Count list items
aux4 browser component --session <id> --type list --action count

# Scroll a component into view
aux4 browser component --session <id> --type nav --action scroll --name "Footer"
```

Supported types: `table`, `form`, `list`, `nav`, `menu`, `dialog`, `tab`, `tree`, `card`.

Actions: `locate`, `click`, `hover`, `read`, `count`, `bounds`, `fill`, `scroll`.

### Assertions

```bash
# Wait for a selector to appear
aux4 browser wait --session <id> --selector ".loaded" --timeout 5000

# Assert on elements
aux4 browser expect --session <id> --selector "h1" --assertion have_text --expected "Welcome"
aux4 browser expect --session <id> --selector ".error" --assertion not_exist

# Assert on lists
aux4 browser expect-list --session <id> --assertion at_least --expected 3
aux4 browser expect-list --session <id> --assertion contains --expected "Settings"

# Get list item texts
aux4 browser get-items --session <id>
```

### Advanced

```bash
# Evaluate JavaScript in the page
aux4 browser eval --session <id> --script "document.title"

# Manage cookies
aux4 browser cookies --session <id> --export cookies.json
aux4 browser cookies --session <id> --import cookies.json

# Download a file
aux4 browser download --session <id> --url https://example.com/file.pdf --output file.pdf

# Save page as PDF
aux4 browser save-pdf --session <id> --output page.pdf --format A4
```

### Tabs

```bash
aux4 browser new-tab --session <id> --url https://example.com
aux4 browser list-tabs --session <id>
aux4 browser switch-tab --session <id> --tab 1
aux4 browser close-tab --session <id> --tab 1
```

### Run (One-Shot Mode)

Run instructions without managing a daemon. Launches a browser, executes, and exits:

```bash
aux4 browser run --instructions steps.txt
aux4 browser run --url https://example.com --instructions steps.txt
```

`steps.txt`:

```text
go to "https://example.com/login"
type "user@test.com" in "Email"
type "secret" in "Password"
click "Sign In"
wait for ".dashboard"
screenshot "after-login.png"
get content
```

### Batch Execute (Daemon Mode)

Execute instructions on an existing daemon session:

```bash
aux4 browser execute --session <id> --instructions steps.txt
```

### MCP Server

```bash
aux4 browser mcp
```

Starts a stdio-based MCP server with all browser tools available. Each tool maps to the corresponding CLI command.

### Playbook Integration

With `aux4/playbook` installed, you can write natural language automation scripts:

```text
set "session" to "abc123"
go to "https://example.com/login"
type "user@test.com" in "Email"
type "secret123" in "Password"
click "Sign In"
wait for ".dashboard"
screenshot "after-login.png"
get content
```

```bash
aux4 playbook execute script.txt
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `--maxSessions` | 20 | Maximum concurrent sessions |
| `--persistent` | false | Keep daemon running when all sessions close |
| `--timeout` | 10m | Session idle timeout |
| `--width` | 1280 | Viewport width |
| `--height` | 720 | Viewport height |
| `--output` | | Directory to save artifacts (screenshots, videos) |
| `--video` | off | Video recording mode: `on`, `off`, `retain-on-failure` |
| `--snapshot` | off | Auto-snapshot mode on actions: `off`, `auto`, `full` |
| `--format` | markdown | Content format: `markdown`, `html`, `text` |
| `--channel` | | Browser channel (e.g. `chrome`, `msedge`) |
| `--browser` | chromium | Browser engine: `chromium`, `firefox`, `webkit` |

## License

Apache-2.0
