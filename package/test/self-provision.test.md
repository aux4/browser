# Self-provision chromium

The daemon self-provisions Playwright's chromium binary on `browser start`. When
chromium is already present (the normal case, and the case in CI once the browser
cache is warm) the provisioning step is a quiet no-op and `start` prints only its
JSON status line to stdout — the installer's download progress, when it runs, is
routed to stderr so stdout stays machine-parsable.

## start prints clean JSON on stdout

```timeout
30000
```

```beforeAll
aux4 browser stop > /dev/null 2>&1
sleep 1
```

```afterAll
aux4 browser stop > /dev/null 2>&1
sleep 1
```

### should emit a single valid JSON status line with no progress noise

```execute
aux4 browser start 2>/dev/null | node -pe "const o=JSON.parse(require('fs').readFileSync(0,'utf8').trim()); ['started','already_running'].includes(o.status) ? 'ok' : 'bad:'+o.status"
```

```expect
ok
```

## start is idempotent

```timeout
30000
```

```afterAll
aux4 browser stop > /dev/null 2>&1
sleep 1
```

### should report already_running on a second start

```execute
aux4 browser start > /dev/null 2>&1
sleep 2
aux4 browser start 2>/dev/null | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8').trim()).status"
```

```expect
already_running
```

## Manual clean-environment verification

The download path cannot run in the standard suite (it fetches ~170 MiB), so
verify it manually on a machine or container where chromium is **not** cached:

```bash
# Simulate a clean environment with an isolated, empty browsers cache
export HOME=/tmp/browser-clean
export PLAYWRIGHT_BROWSERS_PATH=/tmp/browser-clean/pw
mkdir -p "$PLAYWRIGHT_BROWSERS_PATH"

aux4 browser start
# stderr shows: "browser: chromium runtime not found — installing it now ..."
# chromium downloads, then stdout prints only: {"status":"started","pid":<n>}

aux4 browser open --url https://example.com   # confirms chromium launches
aux4 browser stop
rm -rf /tmp/browser-clean
```

In a fresh aux4 docker container the same `aux4 browser start` provisions the
chromium binary automatically. The OS-level shared libraries are declared in the
package `system` field (Linux); for images, bake them in at build time with
`playwright install-deps chromium` (run as root).
