#### Description

Open a new browser session. Returns a session ID for subsequent commands.

Each session is an isolated Playwright BrowserContext with its own cookies, storage, and tabs.

- **`--snapshot`** — Enable auto-snapshots on actions. When set to `auto` or `full`, every action (click, visit, scroll, etc.) returns an accessibility snapshot in the response. Can be changed later with `set-snapshot`.
- **`--video`** — Record video of the session. `retain-on-failure` only keeps the video if an error occurred.
- **`--output`** — Directory for saving artifacts (screenshots, videos). Required for `--video`.

#### Usage

```bash
aux4 browser open [--url <url>] [--timeout 10m] [--width 1280] [--height 720] [--output <dir>] [--video off] [--snapshot off] [--waitUntil load]
```

    --url        URL to navigate to
    --timeout    Session idle timeout (e.g. 10m, 1h). Default: 10m
    --width      Viewport width. Default: 1280
    --height     Viewport height. Default: 720
    --output     Directory to save artifacts (screenshots, videos)
    --video      Video recording mode: on, off, retain-on-failure. Default: off
    --snapshot   Auto-snapshot mode: off, auto, full. Default: off
    --waitUntil  Navigation wait strategy: domcontentloaded, load, networkidle, settle. Default: load

#### Example

```bash
# Basic session
aux4 browser open --url https://example.com

# Session with auto-snapshots for AI agent use
aux4 browser open --url https://example.com --snapshot auto

# Session with video recording
aux4 browser open --url https://example.com --output ./artifacts --video retain-on-failure
```
