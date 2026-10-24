# Release notes

## 1.0.31

Fix `component fill` silently doing nothing (BRW-008). `component`'s `action`
variable had no `arg: true`, so the natural `aux4 browser component fill ...`
syntax dropped the word `fill` entirely, left `action` at its `locate`
default, and returned a convincing `{"status":"ok","count":1,"bounds":{...}}`
without ever writing a value. `action` is now a positional argument, so both
`component fill ...` and `component --action fill ...` work.

`fill` now dispatches per matched element instead of calling `.fill()`
unconditionally: text/email/date/textarea inputs still use `fill()`, `<select>`
uses `selectOption()` (by option label, falling back to value), and
checkboxes/radios use `check()`/`uncheck()` based on a truthy `--value`. A
field that cannot be matched (via `--field` or a key in `--fields`) now always
throws a named error (`component fill: field "X" not found`) instead of
silently resolving as `ok` with `count: 0`.
