#### Description

The `state load` command applies a storage state file (as written by `state save`, or any Playwright `storageState` JSON)
to an existing session, so the session behaves as if it were already logged in.

- **Cookies** — added to the session's browser context.
- **localStorage** — seeded for each saved origin the first time a page of that origin loads, and immediately on the
  current page when its origin matches. Keys the page already has are never overwritten, so the app's own newer values win.
- **Any session type** — works on local sessions and on provider-backed sessions (`cdp:...`, `agentcore:...`).

Load the state before navigating to the site so the first request already carries the cookies. Fails with
`state load: cannot read storage state from <file>` when the file is missing or not valid JSON.

#### Usage

```bash
aux4 browser state load --session <id> --file <file>
```

--session  Session ID (local or provider-backed)
--file     Storage state JSON file (required)

#### Example

```bash
aux4 browser state load --session e5f6a7b8 --file profiles/work.json
aux4 browser visit --session e5f6a7b8 --url https://app.example.com/dashboard
```

```text
{"status":"loaded","cookies":12,"origins":2}
```
