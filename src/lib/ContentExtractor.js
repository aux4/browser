import { visibleChildFrames } from "./BlocksBuilder.js";

// Tags whose content is never readable page text. Same skip rules as
// `browser blocks` (script/style/noscript/template/iframe/svg), plus the
// head-only tags that can end up in <body> on sloppy pages.
export const SKIP_TAGS = ["script", "style", "noscript", "template", "iframe", "svg", "link", "meta", "object", "embed", "canvas"];

// A text-only element that is really an embedded data blob (a JSON state dump
// rendered as text) rather than something a person reads.
export const BLOB_MIN_CHARS = 200;

export class ContentExtractor {
  static async extract(page, options = {}) {
    const { selector, format = "markdown" } = options;
    const element = selector && selector !== "" ? await page.$(selector) : await page.$("body");
    if (!element) return { content: "", warning: "no element found" };

    let content;
    switch (format) {
      case "html":
        content = await element.innerHTML();
        break;
      case "text": {
        const { main, rest } = await ContentExtractor.cleanHtml(element, !selector);
        content = [main, rest]
          .filter(html => html && html.trim())
          .map(html => ContentExtractor.htmlToText(html))
          .filter(Boolean)
          .join("\n\n---\n\n")
          .trim();
        break;
      }
      case "markdown":
      default: {
        const { main, rest } = await ContentExtractor.cleanHtml(element, !selector);
        content = [main, rest]
          .filter(html => html && html.trim())
          .map(html => ContentExtractor.htmlToMarkdown(html))
          .filter(Boolean)
          .join("\n\n---\n\n")
          .trim();
        break;
      }
    }

    // Readable text rendered inside visible child frames is appended after the
    // page's own content (whole-page reads only; html format stays verbatim).
    if (!selector && format !== "html") {
      const frameTexts = await ContentExtractor.extractFrames(page, format);
      if (frameTexts.length) content = [content, ...frameTexts].filter(Boolean).join("\n\n---\n\n").trim();
    }

    const result = { content };
    const warning = ContentExtractor.checkContent(page, content);
    if (warning) result.warning = warning;
    return result;
  }

  // Readable HTML of the element: a clone with script/style/noscript/template/
  // iframe/svg subtrees, JSON-LD and embedded data blobs removed. When
  // `mainFirst` is set and the page has a main landmark (<main> or
  // role="main"), its content comes first and the rest of the page (header,
  // navigation, footer) after it, so a size cap spends its characters on the
  // page's own content.
  static async cleanHtml(element, mainFirst) {
    return element.evaluate((root, { skipTags, blobMinChars, mainFirst }) => {
      // Open shadow roots are flattened into the clone as rendered (slots
      // replaced by their assigned light-DOM nodes), so web-component text
      // is readable; pages without shadow roots take the native fast path.
      const hasShadow = root.shadowRoot || [...root.querySelectorAll("*")].some(el => el.shadowRoot);
      const composedClone = (node) => {
        if (node.nodeType !== 1) return node.cloneNode(false);
        if (node.tagName === "SLOT") {
          const frag = document.createDocumentFragment();
          const assigned = node.assignedNodes({ flatten: true });
          const source = assigned.length ? assigned : [...node.childNodes];
          for (const child of source) frag.appendChild(composedClone(child));
          return frag;
        }
        const copy = node.cloneNode(false);
        const children = node.shadowRoot ? node.shadowRoot.childNodes : node.childNodes;
        for (const child of children) copy.appendChild(composedClone(child));
        return copy;
      };
      const clone = hasShadow ? composedClone(root) : root.cloneNode(true);
      clone.querySelectorAll(skipTags.join(",")).forEach(el => el.remove());
      clone.querySelectorAll("[hidden], [aria-hidden='true']").forEach(el => {
        // icons and screen-reader-hidden decorations; keep anything substantial
        if ((el.textContent || "").trim().length < 40) el.remove();
      });
      clone.querySelectorAll("*").forEach(el => {
        if (el.children.length > 0) return;
        const text = (el.textContent || "").trim();
        if (text.length < blobMinChars) return;
        const first = text[0];
        const last = text[text.length - 1];
        if ((first === "{" && last === "}") || (first === "[" && last === "]")) {
          try { JSON.parse(text); el.remove(); return; } catch { /* not JSON */ }
          if (/^[[{]\s*"[^"]+"\s*:/.test(text)) el.remove();
        }
      });
      if (!mainFirst) return { main: clone.innerHTML, rest: "" };
      const main = clone.querySelector("main, [role='main']");
      if (!main || main === clone) return { main: clone.innerHTML, rest: "" };
      const mainHtml = main.innerHTML;
      main.remove();
      return { main: mainHtml, rest: clone.innerHTML };
    }, { skipTags: SKIP_TAGS, blobMinChars: BLOB_MIN_CHARS, mainFirst });
  }

  static async extractFrames(page, format) {
    const out = [];
    let frames = [];
    try { frames = await visibleChildFrames(page); } catch { return out; }
    for (const frame of frames) {
      try {
        const body = await frame.$("body");
        if (!body) continue;
        const { main, rest } = await Promise.race([
          ContentExtractor.cleanHtml(body, true),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000))
        ]);
        await body.dispose();
        const convert = format === "text" ? ContentExtractor.htmlToText : ContentExtractor.htmlToMarkdown;
        const text = [main, rest].filter(h => h && h.trim()).map(h => convert(h)).filter(Boolean).join("\n\n").trim();
        if (text.length >= 20) out.push(text);
      } catch {
        // cross-origin frame navigated/detached mid-read; skip it
      }
    }
    return out;
  }

  static checkContent(page, content) {
    if (!content || content.length === 0) {
      return "page returned empty content — it may not be fully rendered";
    }
    if (content.length < 100) {
      return "content is very short (<100 chars) — page may not be fully rendered";
    }
    return null;
  }

  static decodeEntities(text) {
    return text
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  static htmlToText(html) {
    return ContentExtractor.decodeEntities(String(html)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer|nav|ul|ol|table)>/gi, "\n")
      .replace(/<[^>]+>/g, ""))
      .replace(/^[ \t]+|[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  static htmlToMarkdown(html) {
    const inline = (s) => String(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    return ContentExtractor.decodeEntities(String(html)
      .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (m, t) => `# ${inline(t)}\n\n`)
      .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (m, t) => `## ${inline(t)}\n\n`)
      .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (m, t) => `### ${inline(t)}\n\n`)
      .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (m, t) => `#### ${inline(t)}\n\n`)
      .replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (m, t) => `##### ${inline(t)}\n\n`)
      .replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (m, t) => `###### ${inline(t)}\n\n`)
      .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, t) => `[${inline(t)}](${href})`)
      .replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**")
      .replace(/<b[^>]*>(.*?)<\/b>/gi, "**$1**")
      .replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*")
      .replace(/<i[^>]*>(.*?)<\/i>/gi, "*$1*")
      .replace(/<code[^>]*>(.*?)<\/code>/gi, "`$1`")
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (m, t) => `- ${inline(t)}\n`)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n")
      .replace(/<\/(div|section|article|tr|table|header|footer|nav)>/gi, "\n")
      .replace(/<img[^>]*>/gi, "")
      .replace(/<[^>]+>/g, ""))
      .replace(/^[ \t]+|[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
}
