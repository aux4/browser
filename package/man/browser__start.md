# browser start

Start the browser daemon.

Before launching, the daemon self-provisions Playwright's chromium binary: if the
executable is not present it is downloaded automatically (the equivalent of
`npx playwright install chromium`). This runs once, is idempotent, and prints a
one-time `browser: chromium runtime not found — installing it now ...` notice to
stderr while downloading. stdout stays clean JSON. When chromium is already
installed the check is silent. There is no separate manual install step.

Chromium's OS package is declared in the package `system` field — `linux:chromium`
(apt/dnf/apk) on Linux and `cask:chromium` (brew cask) on macOS — installed by the
aux4 system installer on `pkger install` when a matching one is present, which pulls
in chromium and its shared libraries.

## Usage

```
aux4 browser start [--maxSessions 20] [--persistent false] [--browser chromium] [--channel <name>] [--headed false]
```

## Options

- `--maxSessions` — Maximum concurrent sessions (default: 20)
- `--persistent` — Keep daemon running when all sessions close (default: false)
- `--browser` — Playwright engine to launch and provision (default: chromium)
- `--channel` — Browser channel to launch (e.g. `chrome`, `msedge`); empty uses the bundled build
- `--headed` — Run a visible (headed) browser window instead of headless (default: false). A headed window strongly reduces bot detection versus headless.

## Example

```bash
aux4 browser start --headed true
```

```text
{"status":"started","pid":25271}
```
