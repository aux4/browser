#### Description

The `state save` command captures a session's storage state — every cookie in the session's browser context plus the
`localStorage` of each origin the session has open — and writes it as JSON to a file. Pair it with `state load` to carry
a logged-in session over to a new session, including a brand new remote browser opened through a provider (for example a
`cdp:` session).

- **Credential-safe output** — the file is created with mode `0600` and the command prints only counts, never the
  cookies or storage values themselves.
- **Any session type** — works on local sessions and on provider-backed sessions (`cdp:...`, `agentcore:...`).
- **Parent directories** — missing directories in the `--output` path are created.

Fails with `state save: --output <file> is required` when no output file is given.

#### Usage

```bash
aux4 browser state save --session <id> --output <file>
```

--session  Session ID (local or provider-backed)
--output   File to write the storage state JSON to (required, created with mode 0600)

#### Example

```bash
aux4 browser state save --session a1b2c3d4 --output profiles/work.json
```

```text
{"status":"saved","path":"profiles/work.json","cookies":12,"origins":2}
```
