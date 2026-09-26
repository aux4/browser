#### Description

Split the current page into content blocks via a single deterministic DOM walk (`page.evaluate`) — no AI involved. Each block is a small, independently-meaningful unit of page content: a heading, a paragraph, a list item, an article/figure card, or a table row. This is the recommended way to feed page content to a downstream ranker (e.g. `aux4 classify rank`) or to an agent deciding what to click next, without losing the metadata a markdown conversion throws away.

Why a DOM walk instead of splitting a markdown/text dump: markdown conversion loses the `href` on containers that wrap other content in a link (e.g. an article card shaped like `<a href><img><span>Title</span></a>`), and it carries no selector, ref, or position information at all. A DOM walk keeps all of that per block.

Each block in the returned array has this shape:

    {
      id,           unique block id within this call (e.g. "b12")
      text,         the block's own text, whitespace-collapsed, capped at --maxBlockChars
      heading,      nearest heading text above this block (null if none)
      headingPath,  array of ancestor heading texts, outermost first
      url,          nearest/enclosing link href — the block's own href if it IS a link,
                    else the nearest ancestor link, else the first link nested inside it
                    (covers cards where a link wraps an image + caption)
      selector,     a stable CSS path to the block's element
      offset,       character offset of this block's text within the page's visible text,
                    in page order (null if it could not be located)
      ref,          snapshot ref number (same numbering as `browser snapshot`/`--ref`) when
                    the block's own element, or its nearest ancestor, is itself a ref'd
                    interactive/component element — lets an agent click straight through
                    from a found block; null otherwise
      tag           lowercase tag name of the block's element
    }

Web components and frames:

- **Open shadow roots** are walked right after their host element, so web-component content becomes blocks in page order.
- **Visible child frames** (at least 100x50 px) contribute their blocks after the page's own, each with an extra `frame` field (the frame URL) and `ref: null` — use `--within` to act inside a frame.
- With `--url`, the command waits up to 8 seconds for a single-page app to render text before walking the page.

Block selection:

- **Candidate elements**: headings (`h1`-`h6`), `p`, `li`, `dd`, `dt`, `figcaption`, `blockquote`, `pre`, `tr`, `article`, `section`.
- **Leaf rule**: a candidate is only emitted as a block if it has no candidate descendant — this keeps a `<article>` wrapping a heading + paragraph from being emitted twice (the nested `h*`/`p` win), while an `<article>` that wraps nothing but a link + image (a pure card) becomes the block itself.
- **Skipped subtrees**: `script`, `style`, `noscript`, `template`, `iframe`, `svg` are always skipped — this is what keeps a large embedded JSON blob (e.g. a Next.js `__NEXT_DATA__` script tag) out of the output entirely. Hidden elements (`hidden` attribute, `aria-hidden="true"`, `display:none`, `visibility:hidden`) are always skipped.
- **Nav landmarks**: `nav`, `footer`, `aside`, `header` and elements with `role="navigation"|"banner"|"contentinfo"|"complementary"` are skipped by default; pass `--includeNav true` to include them.

Works against any active session, local or remote (`--provider cdp`/`agentcore`).

#### Usage

```bash
aux4 browser blocks --session <id> [--url <url>] [--waitUntil load] [--maxBlockChars 1500] [--includeNav false]
```

    --session        Session ID (required)
    --url            Navigate to this URL first; omit to block the current page
    --waitUntil      Navigation wait strategy when --url is given: domcontentloaded, load, networkidle, settle. Default: load
    --maxBlockChars  Cap each block's text at this many characters. Default: 1500
    --includeNav     Include nav/footer/aside/header landmarks (skipped by default). Default: false

#### Example

```bash
aux4 browser open --url https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html
aux4 browser blocks --session abc123
```

```json
[
  {
    "id": "b1",
    "text": "A Light in the Attic",
    "heading": null,
    "headingPath": [],
    "url": null,
    "selector": "div.col-sm-6.product_main > h1",
    "offset": 0,
    "ref": null,
    "tag": "h1"
  },
  {
    "id": "b7",
    "text": "£51.77",
    "heading": "Product Information",
    "headingPath": ["Product Information"],
    "url": null,
    "selector": "#content_inner > article > table > tr:nth-of-type(3) > td",
    "offset": 412,
    "ref": null,
    "tag": "tr"
  }
]
```
