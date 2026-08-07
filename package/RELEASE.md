# Release notes

## `fill` — a whole form in one call

Filling a form meant choosing a command per field: `type` for a text box, `select` for a dropdown,
`check` for a checkbox. Choosing wrong is the most common way a form fill fails, and the error for
using `type` on a dropdown said only that a textbox with that name was never found.

`fill` takes the fields and reads the rest off the page:

```bash
aux4 browser fill --session <id> \
  --field "Full name=Sally Reed" \
  --field "Role=engineer" \
  --field "Country=Brazil" \
  --field "Subscribe to the newsletter=yes"
```

A dropdown value may be the option's label (`Brazil`) or its value (`br`); a checkbox takes
`yes`/`no`. Each field is reported separately, so a partial fill is visible and the fields that
did not fill are named — one bad field never stops the rest. The page state comes back with every
result, and when *nothing* matched, the response says which page you are actually on rather than
suggesting a retry:

```
None of these fields are on this page. You are on http://.../signin, which has:
"Username", "Password", "Sign in". That is probably not the page you expected.
```

## Failures say what to do next

A command that matched nothing reported only what it looked for. Now it reports what is there.

**Wrong role** — asking `type` for something that is a dropdown:

```json
{ "status": "error", "reason": "no-match",
  "matched": [ { "ref": 3, "role": "combobox", "name": "Role" } ],
  "hint": "\"Role\" is a combobox, not a textbox. Use 'aux4 browser select' (or --ref 3)." }
```

**Wrong name** — the elements that exist, each with the ref that would have worked:

```json
{ "clicked": false, "reason": "no-match",
  "candidates": [ { "ref": 4, "role": "button", "name": "Create account" } ],
  "hint": "Nothing matched. Retry with --ref <n> from candidates above." }
```

**No target at all** — `check --selector ...` with no `--name` used to check an arbitrary
checkbox and report success. It now refuses and asks for a target.

`reason` is `no-match` where it was `timeout`: the timeout was how the failure surfaced, not what
went wrong.

## `--ref` on every targeting command

`click` accepted a snapshot ref; `type`, `select`, `check`, `uncheck` and `hover` did not, so the
most reliable handle a snapshot offers worked for one action out of six.

```bash
aux4 browser snapshot --session <id> --format text
#   [2] textbox "Full name"
#   [3] combobox "Role"

aux4 browser type   --session <id> --ref 2 --value "Sally Reed"
aux4 browser select --session <id> --ref 3 --value engineer
```

All six now resolve refs through one shared implementation, so a ref cannot mean one thing to
`snapshot` and another to the command acting on it.

## `<select>` reported a name nothing could match

The accessible-name lookup consulted `<label for>` for `input` and `textarea` only. A `<select>`
fell through to its text content — every option concatenated — so a snapshot advertised

```
[3] combobox "Choose a roleEngineerDesignerManager"
```

while the name that worked was `Role`, which was never shown. Selects now use the same label
lookup, and an unlabelled control reports no name rather than its text content: a name that looks
usable and is not is worse than none.

## Clicks report the page they landed on

`click` returned `{"status":"ok"}` and nothing else, so after submitting a form the caller had no
idea where it ended up — and guessed. It now returns `finalUrl`, `title` and the new page's
elements, and waits for the navigation to commit first: previously the URL could have changed
while the document had not yet rendered, producing a snapshot with no elements at all.

## `open` refuses to discard a session

`open` always creates a *new* session. Calling it again for a host you already have open silently
threw away that session's cookies — you were signed out with no indication. It now refuses:

```
Session 1a2b is already open on site (currently http://site/a).
To go to another page in it: aux4 browser visit --session 1a2b --url http://site/b
If you really need a separate session, pass --new.
```

Only the same host collides; a different site is normal multi-session use and is unaffected.

### Notes

- `--ref` indexes a specific snapshot. Take the snapshot, then act on it — a page that re-renders
  in between can leave the ref pointing elsewhere.
- `--ref` overrides `--name`/`--role` when both are given.
- `fill` handles text boxes, dropdowns, checkboxes, radios and switches. Radio *groups* are not
  addressable by group name yet — each radio matches on its own label.
