# Release notes

## 1.0.27

- `read` / `content` (markdown, text): readable text only. Script, style, noscript, template, iframe and svg content, JSON-LD and embedded JSON data blobs are dropped; a page's main landmark comes first, then `---` and the rest of the page. Multi-line links keep their `[label](href)`.
- `select`: works on custom comboboxes (`role="combobox"` widgets) by opening them and clicking the matching `role="option"`; a clear `no option matching "<value>"` error otherwise.
