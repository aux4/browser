#### Description

Submit a form by clicking its submit control — the natural follow-up to `fill` once every field is filled.
`submit` finds the form, clicks the button that submits it, and reports what changed, same as `click`/`fill`.

- **Finding the form** — in order:
  1. `--within` given: the form with that accessible name (aria-label), or failing that, any element matched
     by `--within` as a CSS selector.
  2. No `--within`: the only `<form>` on the page.
  3. No `--within`, several forms: the form containing the field most recently filled by `fill` or
     `component fill` in this session.
  4. Still ambiguous: the first form on the page.
- **Clicking the control** — `button[type="submit"]` or `input[type="submit"]` inside the form; if neither
  exists and the form has exactly one `<button>`, that button is used instead. If the form has no button at
  all, `submit` calls the form's native `requestSubmit()` (falling back to `submit()`) instead of failing.
- **No form found** — errors naming the page's buttons/links instead of a bare "not found", e.g.
  `submit: no form found on this page (url: ..., title: "Home"). Buttons/links: "Learn more", "Contact us".`
- Reports `{status, button, url, title, errors}` after clicking — `button` is the clicked control's visible
  text when one was clicked, omitted when `requestSubmit()` was used instead. Same after-action shape as
  `click`/`fill`/`type`: waits for the page to settle (bounded by `--wait`) before reading url/title/errors.

#### Usage

```bash
aux4 browser submit --session <id> [--within <form-name-or-selector>] [--timeout 5000] [--wait <ms>]
```

    --session  Session ID; defaults to the most recently used open session when omitted
    --within   The form to submit: its accessible name (aria-label) or a CSS selector. Omit to use the only
               form on the page, or the form containing the most recently filled field
    --timeout  Timeout in milliseconds, for clicking the submit control. Default: 5000
    --wait     Max time to wait for the page to settle before returning, in ms. Default: 5000 (or AUX4_BROWSER_SETTLE_WAIT)

#### Example

```bash
aux4 browser fill --session abc123 --fields '{"Name":"Ann","Email":"ann@example.com"}'
aux4 browser submit --session abc123
```

```json
{"status":"ok","button":"Send","url":"https://example.com/contact","title":"Contact Us"}
```

```bash
# Several forms on the page: name the one to submit
aux4 browser submit --session abc123 --within "Newsletter"
```
