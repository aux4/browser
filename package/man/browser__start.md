# browser start

Start the browser daemon.

Before launching, the daemon self-provisions Playwright's chromium binary: if the
executable is not present it is downloaded automatically (the equivalent of
`npx playwright install chromium`). This runs once, is idempotent, and prints a
one-time `browser: chromium runtime not found — installing it now ...` notice to
stderr while downloading. stdout stays clean JSON. When chromium is already
installed the check is silent. There is no separate manual install step.

On Linux, the OS shared libraries chromium needs are declared in the package
`system` field (installed via the aux4 apt/dnf/apk system installer when present).
For containers, bake them in at build time with `playwright install-deps chromium`
(as root). On macOS chromium is self-contained and needs no extra libraries.

## Usage

```
aux4 browser start [--maxSessions 20] [--persistent false] [--browser chromium]
```

## Options

- `--maxSessions` — Maximum concurrent sessions (default: 20)
- `--persistent` — Keep daemon running when all sessions close (default: false)
- `--browser` — Playwright engine to launch and provision (default: chromium)
