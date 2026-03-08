# aux4/browser

Headless browser automation with daemon architecture and multi-agent session management.

## Install

```bash
aux4 install aux4/browser
npx playwright install chromium
```

## Architecture

```
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

### Interaction

```bash
# Click a button (default role: button)
aux4 browser click --session <id> --name "Submit"

# Type into an input (default role: textbox)
aux4 browser type --session <id> --name "Email" --value "user@test.com"

# Scroll
aux4 browser scroll --session <id> --direction down --amount 500
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

### Advanced

```bash
# Wait for element
aux4 browser wait --session <id> --selector ".loaded" --timeout 5000

# Evaluate JavaScript
aux4 browser eval --session <id> --script "document.title"

# Manage cookies
aux4 browser cookies --session <id> --export cookies.json
aux4 browser cookies --session <id> --import cookies.json

# Download a file
aux4 browser download --session <id> --url https://example.com/file.pdf --output file.pdf
```

### Tabs

```bash
aux4 browser new-tab --session <id> --url https://example.com
aux4 browser list-tabs --session <id>
aux4 browser switch-tab --session <id> --tab 1
aux4 browser close-tab --session <id> --tab 1
```

### Run (One-Shot Mode)

Run instructions without a daemon. Launches a browser, executes, and exits:

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
| `--maxSessions` | 10 | Maximum concurrent sessions |
| `--persistent` | false | Keep daemon running when all sessions close |
| `--timeout` | 10m | Session idle timeout |
| `--width` | 1280 | Viewport width |
| `--height` | 720 | Viewport height |
| `--format` | markdown | Content format: markdown, html, text |

## License

Apache-2.0
