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

With `--localBrowser false` the daemon skips provisioning/launching the local
browser at start and does it lazily, only when the first local session is opened.
Remote sessions (`--provider cdp`, `--provider agentcore`, ...) never need it. An
auto-started daemon uses this mode automatically when the command that started it
targets a remote session.

The socket, pid file and artifacts live in `~/.aux4.config/browser`; set
`AUX4_BROWSER_DIR` to override. When the home directory is not writable (e.g. a
read-only container filesystem) the temp directory is used instead.

## Usage

```
aux4 browser start [--maxSessions 20] [--persistent false] [--browser chromium] [--channel <name>] [--headed false] [--localBrowser true]
```

## Options

- `--maxSessions` — Maximum concurrent sessions (default: 20)
- `--persistent` — Keep daemon running when all sessions close (default: false)
- `--browser` — Playwright engine to launch and provision (default: chromium)
- `--channel` — Browser channel to launch (e.g. `chrome`, `msedge`); empty uses the bundled build
- `--headed` — Run a visible (headed) browser window instead of headless (default: false). A headed window strongly reduces bot detection versus headless.
- `--localBrowser` — Provision and launch the local browser at start (default: true); `false` defers it to the first local session

## Example

```bash
aux4 browser start --headed true
```

```text
{"status":"started","pid":25271}
```
