// BRW-010: `fill --field "Label=value"` is a very natural guess for an agent
// that already knows curl-style repeatable flags (`-H "Header: value"`) —
// more natural than the separate `--fields '{"Label":"value"}'` JSON map.
// This normalizes whatever the CLI handed us (one `--field <label>` with a
// separate `--value`, several `--field "Label=value"` flags, or a single
// `--field "Label=value"` with no `--value`) into either the legacy
// {field, value} pair or a {fields} map — the exact shape the daemon's
// `fill`/`component fill` already understand, so no daemon change is
// needed. Never breaks the plain `--field <label> --value <value>` form:
// that only ever has one field, no "=", and an explicit value, so it always
// falls through to the legacy branch below unchanged.
export function resolveFieldArgs(params) {
  if (params.fields) {
    return { field: undefined, value: undefined, fields: params.fields };
  }

  const raw = params.field;
  const fieldArr = Array.isArray(raw) ? raw : (raw != null && raw !== "" ? [raw] : []);
  if (fieldArr.length === 0) {
    return { field: undefined, value: params.value, fields: undefined };
  }

  const hasEquals = fieldArr.some((f) => typeof f === "string" && f.includes("="));
  const valueGiven = params.value != null && params.value !== "";

  // Multiple --field flags, or a single one with no separate --value and an
  // "=" in it, mean "Label=value" shorthand. A plain single --field (no "=")
  // paired with --value, or a --field that happens to contain "=" but has an
  // explicit --value too, always takes the legacy single-field path — so a
  // label that genuinely contains "=" still works as long as --value is given.
  if (fieldArr.length > 1 || (hasEquals && !valueGiven)) {
    const fields = {};
    for (const entry of fieldArr) {
      const idx = typeof entry === "string" ? entry.indexOf("=") : -1;
      if (idx < 0) {
        throw new Error(`fill: expected --field "Label=value", got "${entry}"`);
      }
      fields[entry.slice(0, idx)] = entry.slice(idx + 1);
    }
    return { field: undefined, value: undefined, fields };
  }

  return { field: fieldArr[0], value: params.value, fields: undefined };
}
