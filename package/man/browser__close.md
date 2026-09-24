#### Description

Close a browser session opened with `browser open`.

For a local session (`--provider local`, the default), this closes the underlying Playwright browser context —
cookies, storage, and any open tabs for that session are discarded. Any video recorded in
`retain-on-failure` mode is deleted since the session closed cleanly.

For a provider-backed session (e.g. one opened with `--provider agentcore`), `close` calls the provider to stop
the remote session for good — it is not just "forget about it locally." This is the only thing that ends a
remote session: letting the local `aux4 browser` daemon exit on its own (`browser stop`, or its idle
auto-shutdown when no sessions remain) does **not** stop a provider-backed session — it stays alive remotely so
a later process can keep using the same `--session` id. `aux4 browser` reattaches to it automatically the next
time that id is used by any command, from any process (see `browser open`).

If `--session` refers to a provider-backed id (recognizable by the `<provider>:` prefix) that isn't tracked
locally — e.g. a brand new daemon process — `close` reattaches to it first before stopping it, so `close
--session <id>` always works regardless of which process originally opened it. If the id's provider isn't
installed, or the underlying remote session no longer exists, `close` fails loudly; it never treats an unknown
session as already closed.

#### Usage

```bash
aux4 browser close --session <id>
```

    --session   Session ID, as returned by `browser open` (required)

#### Example

```bash
SESSION=$(aux4 browser open --url https://example.com)
aux4 browser close --session $SESSION
```

```text
{"status":"closed"}
```
