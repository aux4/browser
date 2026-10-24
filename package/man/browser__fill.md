#### Description

Fill a form field (or several) by its visible label — no component type to pick first. This is the natural
first command to reach for when acting on a single labelled input, text area, `<select>`, checkbox or radio.

- **`--field` / `--value`** — fill one field, matched by its accessible label (`getByLabel`).
- **`--field` is also repeatable as `"Label=value"`** — `--field "Email=a@b.com" --field "Name=Ann"` fills
  both in one call, the curl `-H "Header: value"`-style shortcut for `--fields`. A single `--field "Label=value"`
  with no separate `--value` works the same way. Mixing styles is not needed: a plain `--field <label>` paired
  with an explicit `--value` always takes the original single-field path, even if the label itself contains
  `=`. A repeated `--field` missing the `=` separator errors naming the expected form.
- **`--fields`** — a JSON map of label to value, to fill several fields in one call: `'{"Email":"a@b.com","Name":"Ann"}'`.
- Dispatches per the matched element: `fill()` for text/email/date/textarea, `selectOption()` by option label
  for a `<select>`, `check()`/`uncheck()` for a checkbox or radio based on a truthy `--value` (`true`, `1`,
  `yes`, `on`, `checked`).
- A label that matches no field always errors (`fill: field "X" not found`) — it never silently reports `ok`
  with no effect. The error also lists the labels actually on the page (or says there are none), plus the
  current url/title, e.g. `fill: field "Destination" not found (url: ..., title: "Review"). Fields on this
  page: "Confirm" (checkbox). Buttons/links: "Back", "Pay now".` — capped at 15 fields and 15 buttons/links.
- Reports `{status, url, title, errors}` after writing the value, same as `click`/`type`/`select`/`check` — so
  you know immediately whether the page changed or a validation message appeared, never a bare `{"status":"ok"}`.
  Before reporting, waits for the page to settle — no in-flight network requests AND no DOM mutations for 500ms,
  bounded by `--wait` (default 5000ms, or `AUX4_BROWSER_SETTLE_WAIT` on the daemon) — so an async validation
  message is captured instead of missed.
- **`--within`** scopes the lookup inside an iframe (CSS selector; nest with `>>>`).
- A successful fill also names how to submit the form the filled field belongs to, e.g.
  `"submit":{"button":"Send"}` — a best-effort hint, added on top of the existing fields, never required
  reading. When the submit button can't be resolved it falls back to `"submit":{"hint":"run: aux4 browser submit"}`.
  Follow up with `aux4 browser submit` instead of re-deriving the button yourself.

For a structural component that itself contains labelled fields (e.g. a named `<form>`), use
`aux4 browser component fill --type form ...` instead — `fill` acts on the whole page (or the current
`set-scope`), `component fill` acts within one resolved component.

#### Usage

```bash
aux4 browser fill --session <id> [--field <label> --value <value>] [--fields <json>] [--within <iframe-css>] [--timeout 5000] [--wait <ms>]
```

    --session  Session ID; defaults to the most recently used open session when omitted
    --field    Visible label of the field to fill. Repeatable as --field "Label=value"
               (e.g. --field "Name=Ann" --field "Email=a@b.com"), or a single --field <label>
               paired with --value
    --value    Value to write; a truthy value (true, 1, yes, on) checks a checkbox/radio
    --fields   JSON map of label to value, to fill multiple fields in one call
    --within   Optional iframe CSS selector to scope into (frameLocator); nest with >>>
    --timeout  Timeout in milliseconds. Default: 5000
    --wait     Max time to wait for the page to settle before returning, in ms. Default: 5000 (or AUX4_BROWSER_SETTLE_WAIT)

#### Example

```bash
# One field
aux4 browser fill --session abc123 --field "Email" --value "user@test.com"
```

```json
{"status":"ok","filled":1,"submit":{"button":"Sign Up"},"url":"https://example.com/signup","title":"Sign Up"}
```

```bash
# Several fields in one call, as a JSON map
aux4 browser fill --session abc123 --fields '{"Email":"user@test.com","Password":"secret"}'

# The same, as repeatable --field "Label=value" flags
aux4 browser fill --session abc123 --field "Email=user@test.com" --field "Password=secret"

# A checkbox
aux4 browser fill --session abc123 --field "I agree" --value true
```
