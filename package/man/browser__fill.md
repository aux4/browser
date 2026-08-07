# browser fill

Fill an entire form in one call.

Name each field and its value; the page decides how each one is filled. A text box is typed
into, a dropdown is selected, a checkbox is ticked. You do not have to know which is which —
that is read from the page, not from you.

## Usage

```bash
aux4 browser fill --session <id> \
  --field "Full name=Sally Reed" \
  --field "Role=engineer" \
  --field "Country=Brazil" \
  --field "Subscribe to the newsletter=yes"
```

Field names are the accessible names shown by `aux4 browser snapshot`.

## Values

| Field type | Value |
|---|---|
| text box | the text to type |
| dropdown | the option's label (`Brazil`) or its value (`br`) — either works |
| checkbox | `yes` to tick, `no` to untick |

## Result

Reports each field separately, so a partial fill is visible:

```json
{ "status": "ok", "filled": 4,
  "fields": [ { "field": "Role", "status": "ok", "role": "combobox", "ref": 3 } ] }
```

A field whose name is not on the page comes back with `status: "error"` and the names that are,
while the other fields still fill.

## Notes

- This fills fields only. Submit with `aux4 browser click --name "<button>"`.
- Names are matched case-insensitively against the accessible name.
