#### Description

The `actions` command lists every control a person could use on the current page of a session: text fields,
selects and custom comboboxes, checkboxes, radios, links, buttons, options, menu items, tabs, and elements with no
ARIA role that are clickable anyway (focusable, with a click handler or a pointer cursor — suggestion items, cards).
Only visible, enabled controls that are not covered by another element (e.g. the page behind a modal dialog) are
listed, including controls inside open shadow roots and visible iframes.

Each entry has:

- **`id`** — the entry's number in this listing (renumbered on every call)
- **`ref`** — the snapshot ref when the control has one (`click`, `type`, `select`, `check` accept `--ref`); `null`
  for role-less controls and controls inside iframes
- **`selector`** — a CSS selector that addresses the control exactly (`click-selector`, `type/select/check
  --selector`); **`within`** — the iframe selector to pass as `--within` for controls inside a frame
- **`role`** — `textbox`, `searchbox`, `combobox`, `select`, `checkbox`, `switch`, `radio`, `option`, `menuitem`,
  `tab`, `link`, `button`, `card` (clickable, no role) or `segmented` (a value split over several short boxes, with
  `parts` and `lens`)
- **`label`**, **`value`** (current value; passwords masked), `checked`, `expanded`, `required`, `options` (native
  select), `href`/`target` (links), `autocomplete` (a field that lists suggestions)
- **`context`** — `region` (`dialog`, `list`, `main`, `form`, `header`, `nav`, `footer`, `aside`, `page`), its `name`,
  the `headingPath` above the control and a one-line `text`

Controls in page chrome (header, nav, footer, aside) are skipped unless `--includeNav true`. With `--page true` the
result also carries `page`: the visible `headings`, visible error messages (`errors`), the start of the main text
(`text`), the page's text `blocks` and its `textLength`.

#### Usage

```bash
aux4 browser actions --session <id> [--within <iframe-css>] [--includeNav true] [--page true]
```

--session     Session ID (required)
--within      Only list the controls inside this iframe (CSS selector; nest with `>>>`)
--includeNav  Include controls in header/nav/footer/aside landmarks (default: `false`)
--page        Also return headings, errors, main text and text blocks (default: `false`)

#### Example

```bash
aux4 browser actions --session 1694f329
```

```json
{
  "url": "https://example.com/find-care",
  "title": "Find Care",
  "dialog": "",
  "actions": [
    {
      "id": 1,
      "ref": 5,
      "role": "button",
      "tag": "button",
      "label": "Location",
      "context": { "region": "main", "headingPath": ["Find a doctor", "Where"], "text": "main > Where" },
      "selector": "[data-aux4-el=\"1\"]"
    },
    {
      "id": 3,
      "ref": null,
      "role": "card",
      "tag": "div",
      "label": "Venice, CA 90292",
      "context": { "region": "main", "headingPath": ["Find a doctor", "Where"], "text": "main > Where" },
      "selector": "[data-aux4-el=\"3\"]"
    }
  ],
  "count": 2
}
```

Act on an entry:

```bash
aux4 browser click-selector --session 1694f329 --selector '[data-aux4-el="3"]'
```
