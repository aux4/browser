#### Description

Fill a form field (or several) by its visible label — no component type to pick first. This is the natural
first command to reach for when acting on a single labelled input, text area, `<select>`, checkbox or radio.

- **`--field` / `--value`** — fill one field, matched by its accessible label (`getByLabel`).
- **`--fields`** — a JSON map of label to value, to fill several fields in one call: `'{"Email":"a@b.com","Name":"Ann"}'`.
- Dispatches per the matched element: `fill()` for text/email/date/textarea, `selectOption()` by option label
  for a `<select>`, `check()`/`uncheck()` for a checkbox or radio based on a truthy `--value` (`true`, `1`,
  `yes`, `on`, `checked`).
- A label that matches no field always errors (`fill: field "X" not found`) — it never silently reports `ok`
  with no effect.
- Reports `{status, url, title, errors}` after writing the value, same as `click`/`type`/`select`/`check` — so
  you know immediately whether the page changed or a validation message appeared, never a bare `{"status":"ok"}`.
- **`--within`** scopes the lookup inside an iframe (CSS selector; nest with `>>>`).

For a structural component that itself contains labelled fields (e.g. a named `<form>`), use
`aux4 browser component fill --type form ...` instead — `fill` acts on the whole page (or the current
`set-scope`), `component fill` acts within one resolved component.

#### Usage

```bash
aux4 browser fill --session <id> [--field <label> --value <value>] [--fields <json>] [--within <iframe-css>] [--timeout 5000]
```

    --session  Session ID (required)
    --field    Visible label of the field to fill
    --value    Value to write; a truthy value (true, 1, yes, on) checks a checkbox/radio
    --fields   JSON map of label to value, to fill multiple fields in one call
    --within   Optional iframe CSS selector to scope into (frameLocator); nest with >>>
    --timeout  Timeout in milliseconds. Default: 5000

#### Example

```bash
# One field
aux4 browser fill --session abc123 --field "Email" --value "user@test.com"
```

```json
{"status":"ok","filled":1,"url":"https://example.com/signup","title":"Sign Up"}
```

```bash
# Several fields in one call
aux4 browser fill --session abc123 --fields '{"Email":"user@test.com","Password":"secret"}'

# A checkbox
aux4 browser fill --session abc123 --field "I agree" --value true
```
