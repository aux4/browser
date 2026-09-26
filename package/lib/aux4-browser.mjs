import { execFile, spawnSync, spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { webkit, firefox, chromium } from 'playwright';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

/**
 * BlocksBuilder — splits the current page into content "blocks" via a single
 * deterministic DOM walk (page.evaluate), no AI involved.
 *
 * Built for CBR-042 (find build 3, spec CBR-039): a block is a small,
 * independently-meaningful unit of page content — a heading, a paragraph, a
 * list item, an article/figure card, a table row — carrying enough metadata
 * (selector, url, ref, offset, headingPath) that a downstream ranker
 * (`aux4 classify rank`) or an agent can locate and act on the winning block
 * without re-parsing the page.
 *
 * Why a DOM walk and not a markdown post-split: markdown conversion loses
 * hrefs on containers that wrap an image/other content in a link (e.g.
 * thenextweb.com article cards — `<a href><img><span>Title</span></a>`), and
 * loses ref/selector information entirely. See kb
 * "cloud-browser-cbr-039-spike-results" (10/15 thenextweb article cards lost
 * their href under markdown splitting).
 *
 * Shape returned per block:
 *   { id, text, heading, headingPath: [...], url, selector, offset, ref, tag }
 *
 * `ref` mirrors the numbering SnapshotBuilder/_resolveRefElement use (a
 * sequential index over visible interactive+component-role elements, walked
 * document order) — it is attached to a block when the block's own element,
 * or its nearest ancestor, is itself one of those ref'd elements, so an
 * agent can click straight through from a found block.
 */

const INTERACTIVE_ROLES$1 = [
  "button", "link", "textbox", "checkbox", "radio", "combobox", "listbox",
  "menuitem", "tab", "switch", "searchbox", "slider", "spinbutton", "option"
];

const COMPONENT_ROLES$1 = ["table", "form", "list", "navigation", "menu", "dialog", "tablist", "tree"];

// Elements whose whole subtree is skipped outright — never a block, never
// walked into. Script/style/template/iframe bodies are not page content;
// this is also what keeps a huge embedded JSON blob (e.g. a Next.js
// `<script id="__NEXT_DATA__" type="application/json">`) out of blocks
// entirely, since it always lives inside a <script> tag.
const SKIP_SUBTREE_TAGS = new Set(["script", "style", "noscript", "template", "iframe", "svg"]);

// Landmark-ish containers skipped unless includeNav — these are chrome, not
// content: global nav bars, footers, sidebars, page headers.
const NAV_TAGS = new Set(["nav", "footer", "aside", "header"]);
const NAV_ROLES = new Set(["navigation", "banner", "contentinfo", "complementary"]);

// Candidate block elements. A candidate is emitted as a block only if it is
// a *leaf* candidate (no candidate descendant) — see isLeafCandidate below.
// This naturally turns <article>/<section> into a block only when they wrap
// something with no nested heading/paragraph/list-item of their own (e.g. a
// pure image+link card), and otherwise lets their nested h*/p/li win. nav/
// footer/aside/header are candidates too, for the same reason: skipped by
// default (see NAV_TAGS), but when --includeNav pulls them into the walk, a
// nav bar that's just a run of links (no nested p/li/h*) still becomes one
// block instead of vanishing for having no other candidate inside it.
const CANDIDATE_SELECTOR = "h1,h2,h3,h4,h5,h6,p,li,dd,dt,figcaption,blockquote,pre,tr,article,section,nav,footer,aside,header";

class BlocksBuilder {
  static async build(page, options = {}) {
    const maxBlockChars = parseInt(options.maxBlockChars) || 1500;
    const includeNav = options.includeNav === true || options.includeNav === "true";

    const args = {
        interactiveRoles: INTERACTIVE_ROLES$1,
        componentRoles: COMPONENT_ROLES$1,
        navTags: [...NAV_TAGS],
        navRoles: [...NAV_ROLES],
        skipTags: [...SKIP_SUBTREE_TAGS],
        candidateSelector: CANDIDATE_SELECTOR,
        maxBlockChars,
        includeNav
    };
    const result = await page.evaluate(collectBlocks, args);

    // Content rendered inside visible child frames (same- or cross-origin):
    // their blocks follow the page's own, tagged with `frame` (the frame URL)
    // and without a ref — refs only address the top document; act inside a
    // frame with --within.
    const frames = await visibleChildFrames(page);
    for (const frame of frames) {
      let frameResult;
      try {
        frameResult = await withTimeout(frame.evaluate(collectBlocks, { ...args, isFrame: true }), 5000);
      } catch {
        continue;
      }
      if (!frameResult || !frameResult.blocks.length) continue;
      for (const block of frameResult.blocks) {
        result.blocks.push({ ...block, id: `b${result.blocks.length + 1}`, ref: null, offset: null, frame: frame.url() });
      }
    }
    result.blockCount = result.blocks.length;
    return result;
  }
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

// Child frames whose <iframe> element is visible and at least 100x50 —
// tracking pixels, storage bridges and hidden analytics frames are skipped.
async function visibleChildFrames(page) {
  const out = [];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    if (frame.parentFrame() !== page.mainFrame()) continue;
    try {
      const element = await frame.frameElement();
      const box = await element.boundingBox();
      await element.dispose();
      if (!box || box.width < 100 || box.height < 50) continue;
      out.push(frame);
    } catch {
      // detached while inspecting
    }
  }
  return out;
}

function collectBlocks({ interactiveRoles, componentRoles, navTags, navRoles, skipTags, candidateSelector, maxBlockChars, includeNav }) {
        const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

        const isVisible = (el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return false;
          const style = window.getComputedStyle(el);
          if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") return false;
          return true;
        };

        const implicitRole = (el) => {
          const tag = el.tagName.toLowerCase();
          switch (tag) {
            case "a": return el.hasAttribute("href") ? "link" : null;
            case "button": return "button";
            case "input": {
              const type = (el.getAttribute("type") || "text").toLowerCase();
              if (type === "checkbox") return "checkbox";
              if (type === "radio") return "radio";
              if (type === "submit" || type === "button" || type === "reset") return "button";
              if (type === "range") return "slider";
              if (type === "number") return "spinbutton";
              if (type === "search") return "searchbox";
              return "textbox";
            }
            case "textarea": return "textbox";
            case "select": return "combobox";
            case "nav": return "navigation";
            case "table": return "table";
            case "form": return "form";
            case "ul": case "ol": return "list";
            case "dialog": return "dialog";
            case "option": return "option";
            default: return null;
          }
        };

        const isNavLike = (el) => {
          const tag = el.tagName.toLowerCase();
          if (navTags.includes(tag)) return true;
          const role = el.getAttribute("role");
          if (role && navRoles.includes(role)) return true;
          return false;
        };

        const isHidden = (el) => {
          if (el.hasAttribute("hidden")) return true;
          if (el.getAttribute("aria-hidden") === "true") return true;
          const style = window.getComputedStyle(el);
          return style.display === "none" || style.visibility === "hidden";
        };

        // --- ref map: same algorithm/order as SnapshotBuilder/_resolveRefElement
        // (interactive + component roles, visible, document order) so a ref
        // emitted here resolves to the same element via --ref elsewhere. ---
        const allRefRoles = [...interactiveRoles, ...componentRoles];
        const refMap = new Map();
        let refCounter = 0;
        for (const el of (() => { const out = []; const walk = (root) => { for (const el of root.querySelectorAll("*")) { out.push(el); if (el.shadowRoot) walk(el.shadowRoot); } }; walk(document); return out; })()) {
          const role = el.getAttribute("role") || implicitRole(el);
          if (!role || !allRefRoles.includes(role)) continue;
          if (!isVisible(el)) continue;
          refCounter++;
          refMap.set(el, refCounter);
        }

        const findRef = (el) => {
          let cur = el;
          while (cur && cur.nodeType === 1) {
            if (refMap.has(cur)) return refMap.get(cur);
            cur = cur.parentElement;
          }
          return null;
        };

        const findUrl = (el) => {
          if (el.tagName.toLowerCase() === "a" && el.hasAttribute("href")) return el.href;
          const ancestorLink = el.closest("a[href]");
          if (ancestorLink) return ancestorLink.href;
          const descendantLink = el.querySelector("a[href]");
          if (descendantLink) return descendantLink.href;
          return null;
        };

        const cssPath = (el) => {
          if (el.id) return `#${CSS.escape(el.id)}`;
          const parts = [];
          let cur = el;
          while (cur && cur.nodeType === 1 && cur !== document.body) {
            if (cur.id) {
              parts.unshift(`#${CSS.escape(cur.id)}`);
              break;
            }
            let selector = cur.tagName.toLowerCase();
            const parent = cur.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
              if (siblings.length > 1) {
                selector += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
              }
            }
            parts.unshift(selector);
            cur = parent;
          }
          return parts.length ? parts.join(" > ") : "body";
        };

        const isLeafCandidate = (el) => !el.querySelector(candidateSelector);

        const HEADING_LEVEL = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

        // Single walk in document order: skip whole subtrees for
        // script/style/template/iframe/svg, hidden elements, and (unless
        // includeNav) nav/footer/aside/header landmarks; track a heading
        // stack; emit a block for every visible, leaf candidate element.
        const makeWalker = (root) => document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
          acceptNode(node) {
            const tag = node.tagName.toLowerCase();
            if (skipTags.includes(tag)) return NodeFilter.FILTER_REJECT;
            if (!includeNav && isNavLike(node)) return NodeFilter.FILTER_REJECT;
            if (isHidden(node)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        });

        const headingStack = [];
        const blocks = [];
        let seq = 0;
        if (!document.body) return { url: location.href, title: document.title, blockCount: 0, blocks };

        // Open shadow roots are walked right after their host (same order
        // as the ref walk), so web-component content becomes blocks too.
        const walkers = [makeWalker(document.body)];
        const nextNode = () => {
          while (walkers.length) {
            const n = walkers[walkers.length - 1].nextNode();
            if (n) {
              if (n.shadowRoot) walkers.push(makeWalker(n.shadowRoot));
              return n;
            }
            walkers.pop();
          }
          return null;
        };
        let node;

        while ((node = nextNode())) {
          const tag = node.tagName.toLowerCase();

          if (HEADING_LEVEL[tag]) {
            const level = HEADING_LEVEL[tag];
            while (headingStack.length && headingStack[headingStack.length - 1].level >= level) {
              headingStack.pop();
            }
            const text = norm(node.textContent);
            if (text) headingStack.push({ level, text });
          }

          if (!node.matches(candidateSelector)) continue;
          if (!isVisible(node)) continue;
          if (!isLeafCandidate(node)) continue;

          let text = norm(node.shadowRoot ? node.shadowRoot.textContent + " " + node.textContent : node.textContent);
          if (!text) continue;

          const truncated = text.length > maxBlockChars;
          if (truncated) text = text.slice(0, maxBlockChars);

          const headingPath = headingStack.map((h) => h.text);
          seq++;

          const block = {
            id: `b${seq}`,
            text,
            heading: headingPath.length ? headingPath[headingPath.length - 1] : null,
            headingPath,
            url: findUrl(node),
            selector: cssPath(node),
            offset: null,
            ref: findRef(node),
            tag
          };
          if (truncated) block.truncated = true;
          blocks.push(block);
        }

        // Offset pass: locate each block's normalized text inside the page's
        // normalized visible text, in document order, advancing the search
        // cursor after each match so repeated identical blocks (e.g. the
        // same price on several cards) each get their own offset.
        const fullText = norm(document.body.innerText || document.body.textContent || "");
        let cursor = 0;
        for (const block of blocks) {
          const idx = fullText.indexOf(block.text, cursor);
          if (idx >= 0) {
            block.offset = idx;
            cursor = idx + 1;
          }
        }

        return {
          url: location.href,
          title: document.title,
          blockCount: blocks.length,
          blocks
        };
}

// Tags whose content is never readable page text. Same skip rules as
// `browser blocks` (script/style/noscript/template/iframe/svg), plus the
// head-only tags that can end up in <body> on sloppy pages.
const SKIP_TAGS = ["script", "style", "noscript", "template", "iframe", "svg", "link", "meta", "object", "embed", "canvas"];

// A text-only element that is really an embedded data blob (a JSON state dump
// rendered as text) rather than something a person reads.
const BLOB_MIN_CHARS = 200;

class ContentExtractor {
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

/**
 * SnapshotBuilder — builds a compact accessibility snapshot of the current page.
 *
 * Returns a lightweight structure an agent can consume to decide the next action
 * without having to screenshot → read image → guess → click.
 *
 * Shape:
 *   {
 *     url, title,
 *     elements: [{ ref, role, name, bounds, component? }, ...],
 *     components: [{ ref, type, name, rows?, items?, fields? }, ...]
 *   }
 *
 * `ref` is a 1-based index stable within this snapshot. Agents can pass it to
 * commands via `--ref N` to act without re-resolving names.
 *
 * `mode`:
 *   - "off"  → returns null
 *   - "auto" → returns elements + components, elements truncated to ~50
 *   - "full" → no truncation, includes text nodes
 */

const INTERACTIVE_ROLES = [
  "button", "link", "textbox", "checkbox", "radio", "combobox", "listbox",
  "menuitem", "tab", "switch", "searchbox", "slider", "spinbutton", "option"
];

const COMPONENT_ROLES = {
  table: "table",
  form: "form",
  list: "list",
  navigation: "nav",
  menu: "menu",
  dialog: "dialog",
  tablist: "tablist",
  tree: "tree"
};

class SnapshotBuilder {
  static async build(page, mode = "auto") {
    if (mode === "off") return null;

    const full = mode === "full";

    const data = await page.evaluate(({ interactiveRoles, componentRoles, full }) => {
      const isVisible = (el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") return false;
        return true;
      };

      const implicitRole = (el) => {
        const tag = el.tagName.toLowerCase();
        switch (tag) {
          case "a": return el.hasAttribute("href") ? "link" : null;
          case "button": return "button";
          case "input": {
            const type = (el.getAttribute("type") || "text").toLowerCase();
            if (type === "checkbox") return "checkbox";
            if (type === "radio") return "radio";
            if (type === "submit" || type === "button" || type === "reset") return "button";
            if (type === "range") return "slider";
            if (type === "number") return "spinbutton";
            if (type === "search") return "searchbox";
            return "textbox";
          }
          case "textarea": return "textbox";
          case "select": return "combobox";
          case "nav": return "navigation";
          case "table": return "table";
          case "form": return "form";
          case "ul":
          case "ol": return "list";
          case "li": return "listitem";
          case "dialog": return "dialog";
          case "option": return "option";
          default: return null;
        }
      };

      const getRole = (el) => (el.getAttribute("role") || implicitRole(el));

      const getName = (el) => {
        const aria = el.getAttribute("aria-label");
        if (aria) return aria.trim();
        const labelledBy = el.getAttribute("aria-labelledby");
        if (labelledBy) {
          const ref = document.getElementById(labelledBy);
          if (ref) return (ref.textContent || "").trim().slice(0, 120);
        }
        if (el.tagName.toLowerCase() === "input" || el.tagName.toLowerCase() === "textarea") {
          if (el.id) {
            const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
            if (label) return (label.textContent || "").trim().slice(0, 120);
          }
          const parentLabel = el.closest("label");
          if (parentLabel) return (parentLabel.textContent || "").trim().slice(0, 120);
          const placeholder = el.getAttribute("placeholder");
          if (placeholder) return placeholder.trim();
        }
        const title = el.getAttribute("title");
        if (title) return title.trim();
        const text = (el.textContent || "").trim().replace(/\s+/g, " ");
        return text.slice(0, 120);
      };

      const bounds = (el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      };

      // document order, open shadow roots walked right after their host
      const all = (() => { const out = []; const walk = (root) => { for (const el of root.querySelectorAll("*")) { out.push(el); if (el.shadowRoot) walk(el.shadowRoot); } }; walk(document); return out; })();
      const elements = [];
      const components = [];
      let ref = 0;

      for (const el of all) {
        const role = getRole(el);
        if (!role) continue;
        if (!isVisible(el)) continue;

        if (interactiveRoles.includes(role)) {
          ref++;
          const entry = { ref, role, name: getName(el), bounds: bounds(el) };
          if (el.getAttribute("disabled") != null) entry.disabled = true;
          elements.push(entry);
        } else if (componentRoles[role]) {
          ref++;
          const type = componentRoles[role];
          const comp = { ref, type, name: getName(el), bounds: bounds(el) };

          if (type === "table") {
            const rows = el.querySelectorAll("tr").length;
            const headers = Array.from(el.querySelectorAll("thead th, tr:first-child th"))
              .map(th => (th.textContent || "").trim())
              .filter(Boolean);
            comp.rows = rows;
            if (headers.length) comp.headers = headers;
          } else if (type === "list") {
            comp.items = el.querySelectorAll(":scope > li, :scope > [role='listitem']").length;
          } else if (type === "form") {
            const fields = Array.from(el.querySelectorAll("input, textarea, select"))
              .map(f => getName(f))
              .filter(Boolean);
            comp.fields = fields;
          }

          components.push(comp);
        }
      }

      return {
        url: location.href,
        title: document.title,
        elements: full ? elements : elements.slice(0, 50),
        components,
        truncated: !full && elements.length > 50 ? elements.length - 50 : 0
      };
    }, { interactiveRoles: INTERACTIVE_ROLES, componentRoles: COMPONENT_ROLES, full });

    // Visible child frames aren't walked for refs (refs address the top
    // document); list them so an agent can act inside with --within.
    const frames = await SnapshotBuilder.frames(page);
    if (frames.length) data.frames = frames;

    return data;
  }

  static async frames(page) {
    const out = [];
    let frames = [];
    try { frames = await visibleChildFrames(page); } catch { return out; }
    for (const frame of frames) {
      try {
        const element = await frame.frameElement();
        const within = await element.evaluate((el) => {
          if (el.id) return `#${CSS.escape(el.id)}`;
          for (const attr of ["name", "title", "src"]) {
            const v = el.getAttribute(attr);
            if (v) return `iframe[${attr}="${v.replace(/"/g, '\\"')}"]`;
          }
          return null;
        });
        await element.dispose();
        out.push({ url: frame.url(), ...(within ? { within } : {}) });
      } catch {
        // detached
      }
    }
    return out;
  }

  /**
   * Render a snapshot as compact text (for logs, playbook output).
   */
  static render(snapshot) {
    if (!snapshot) return "";
    const lines = [`# ${snapshot.title}`, snapshot.url, ""];
    if (snapshot.components.length) {
      lines.push("## Components");
      for (const c of snapshot.components) {
        let line = `  [${c.ref}] ${c.type}`;
        if (c.name) line += ` "${c.name}"`;
        if (c.rows != null) line += ` (${c.rows} rows)`;
        if (c.items != null) line += ` (${c.items} items)`;
        if (c.fields?.length) line += ` fields: ${c.fields.join(", ")}`;
        lines.push(line);
      }
      lines.push("");
    }
    lines.push("## Elements");
    for (const e of snapshot.elements) {
      lines.push(`  [${e.ref}] ${e.role} "${e.name}"${e.disabled ? " (disabled)" : ""}`);
    }
    if (snapshot.truncated) lines.push(`  ... and ${snapshot.truncated} more`);
    if (snapshot.frames?.length) {
      lines.push("", "## Frames");
      for (const f of snapshot.frames) lines.push(`  ${f.url}${f.within ? ` (--within '${f.within}')` : ""}`);
    }
    return lines.join("\n");
  }
}

/**
 * ComponentResolver — resolves a (component-type, params) pair to a live
 * Playwright locator using accessibility-first strategies.
 *
 * A "component" is a structural UI element (table, form, list, nav, menu,
 * dialog, tab, tree, card). Each component has its own parameter schema; the
 * resolver picks a strategy based on which params are present.
 *
 * Callers should not assume the returned value is a single element — it may
 * be a multi-match locator depending on params. Use `.first()` or actions
 * like `.click()` which accept their own timeouts.
 */

const isIndex = (v) => v != null && v !== "" && /^\d+$/.test(String(v));

const byName = (base, role, name) => {
  return name ? base.getByRole(role, { name }) : base.getByRole(role);
};

const resolveTable = async (base, p) => {
  let table = byName(base, "table", p.name);
  if (!p.row && !p.col && !p.where) return table;

  let row;
  if (isIndex(p.row)) {
    // 1-based over all rows including header. Row 1 = header, row 2 = first data row.
    row = table.getByRole("row").nth(parseInt(p.row) - 1);
  } else if (p.row) {
    row = table.getByRole("row").filter({ hasText: p.row }).first();
  } else if (p.where) {
    const [, value] = String(p.where).split("=", 2);
    row = table.getByRole("row").filter({ hasText: value }).first();
  } else {
    row = table.getByRole("row");
  }

  if (!p.col) return row;

  let colIndex;
  if (isIndex(p.col)) {
    colIndex = parseInt(p.col) - 1;
  } else {
    // Look up column index by header text.
    const headers = await table.getByRole("row").first().getByRole("columnheader").allTextContents();
    const normalized = headers.map(h => h.trim().toLowerCase());
    const idx = normalized.indexOf(String(p.col).trim().toLowerCase());
    if (idx < 0) {
      throw new Error(`Column "${p.col}" not found. Available headers: ${headers.join(", ")}`);
    }
    colIndex = idx;
  }

  return row.getByRole("cell").nth(colIndex);
};

const resolveForm = (base, p) => {
  let form = byName(base, "form", p.name);
  if (p.field) {
    return form.getByLabel(p.field).first();
  }
  return form;
};

const resolveList = (base, p) => {
  let list = byName(base, "list", p.name);
  if (!p.item) return list;
  const items = list.getByRole("listitem");
  if (isIndex(p.item)) return items.nth(parseInt(p.item) - 1);
  return items.filter({ hasText: p.item }).first();
};

const resolveNav = (base, p) => {
  let nav = byName(base, "navigation", p.name);
  if (!p.item) return nav;
  return nav.getByRole("link", { name: p.item }).first();
};

const resolveMenu = (base, p) => {
  let menu = byName(base, "menu", p.name);
  if (!p.item) return menu;
  return menu.getByRole("menuitem", { name: p.item }).first();
};

const resolveDialog = (base, p) => {
  return byName(base, "dialog", p.name);
};

const resolveTab = (base, p) => {
  let tablist = byName(base, "tablist", p.name);
  if (!p.tab) return tablist;
  if (isIndex(p.tab)) return tablist.getByRole("tab").nth(parseInt(p.tab) - 1);
  return tablist.getByRole("tab", { name: p.tab }).first();
};

const resolveTree = (base, p) => {
  let tree = byName(base, "tree", p.name);
  if (!p.path) return tree;
  // Path like "A>B>C" — walk treeitems by label; return final item.
  const parts = String(p.path).split(">").map(s => s.trim()).filter(Boolean);
  let current = tree;
  for (const part of parts) {
    current = current.getByRole("treeitem", { name: part }).first();
  }
  return current;
};

const resolveCard = (base, p) => {
  // No native ARIA "card" role. Match region/article with title.
  const title = p.title || p.name;
  if (title) {
    const region = base.getByRole("article", { name: title }).or(base.getByRole("region", { name: title }));
    return region.first();
  }
  return base.getByRole("article");
};

const RESOLVERS = {
  table: resolveTable,
  form: resolveForm,
  list: resolveList,
  nav: resolveNav,
  menu: resolveMenu,
  dialog: resolveDialog,
  tab: resolveTab,
  tree: resolveTree,
  card: resolveCard
};

class ComponentResolver {
  static async resolve(base, type, params = {}) {
    const fn = RESOLVERS[type];
    if (!fn) {
      throw new Error(`Unknown component type: "${type}". Available: ${Object.keys(RESOLVERS).join(", ")}`);
    }
    return await fn(base, params);
  }

  static types() {
    return Object.keys(RESOLVERS);
  }
}

const BROWSERS = { chromium, firefox, webkit };

class BrowserEngine {
  static async launch(options = {}) {
    const { channel, browser: browserName, headed, ...launchOptions } = options;
    const engine = BROWSERS[browserName] || chromium;
    if (channel) launchOptions.channel = channel;
    // headed (visible) Chrome dramatically lowers bot-detection vs headless
    return engine.launch({ headless: !headed, ...launchOptions });
  }

  // Attach to a remote Chromium instance over CDP (e.g. an Amazon Bedrock
  // AgentCore Browser session) instead of launching a local process. The
  // default browser context/page belong to the remote session and are NOT
  // owned by this process — closing this Browser handle must not tear them
  // down (see SessionManager's "remote" mode).
  static async connect(wsUrl, headers = {}) {
    return chromium.connectOverCDP(wsUrl, { headers });
  }
}

// The provider seam: aux4/browser core knows nothing about any remote
// browser vendor (AWS Bedrock AgentCore, or any future provider). A
// "provider" is just a name: when it's not "local", core shells out to a
// sibling aux4 command named "<provider>-open" / "<provider>-attach" /
// "<provider>-close" that a plugin package (e.g. aux4/browser-agentcore)
// contributes into the SAME "browser" profile — exactly like
// aux4/classify-jev adds "jev-ask" alongside aux4/classify's "ask".
//
// Contract (plugin -> core), all JSON on stdout:
//   <provider>-open   params: whatever the user passed to `browser open`
//                      (e.g. awsProfile, awsRegion, timeout)
//                      returns: { token, wsUrl, headers }
//   <provider>-attach params: { token }
//                      returns: { wsUrl, headers }
//   <provider>-close  params: { token }
//                      returns: { status: "closed" }
//
// `token` is opaque to core — the provider decides what it needs to encode
// in order to reattach or stop the session later (region, session id,
// credentials profile, etc). Core only ever does
// `chromium.connectOverCDP(wsUrl, { headers })` with what the provider hands
// back (see BrowserEngine.connect). If the plugin isn't installed, or the
// provider call fails for any reason, this throws loudly — core never falls
// back to launching a local browser.

const execFileAsync = promisify(execFile);

function buildArgs(provider, action, params = {}) {
  const args = ["browser", `${provider}-${action}`];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    args.push(`--${key}`, String(value));
  }
  return args;
}

async function runProviderCommand(provider, action, params) {
  const args = buildArgs(provider, action, params);
  let stdout;
  try {
    ({ stdout } = await execFileAsync("aux4", args, { maxBuffer: 10 * 1024 * 1024 }));
  } catch (e) {
    const detail = (e.stderr || e.message || "").toString().trim();
    throw new Error(`browser provider "${provider}" is unavailable or failed on ${action}: ${detail}`);
  }
  const lastLine = stdout.trim().split("\n").filter(Boolean).pop() || "";
  try {
    return JSON.parse(lastLine);
  } catch {
    throw new Error(`browser provider "${provider}" ${action} returned invalid JSON: ${stdout}`);
  }
}

const ProviderBridge = {
  open: (provider, params) => runProviderCommand(provider, "open", params),
  attach: (provider, params) => runProviderCommand(provider, "attach", params),
  close: (provider, params) => runProviderCommand(provider, "close", params)
};

// Redaction helpers (CBR-015). Provider-backed session ids can be bearer
// credentials in disguise: the built-in "cdp" provider's id is literally
// "cdp:<base64url(wsUrl)>" — a short-lived (<=300s) presigned WebSocket URL
// with its auth in the query string (e.g. X-Amz-Signature). "<provider>:<token>"
// ids minted by a plugin (e.g. "agentcore:<token>") can likewise embed
// reattach material. None of that belongs in a status listing, a log line,
// or an error message: it does not help debug the failure, and every extra
// place it is printed is another place it can leak (shell history, CI logs,
// a ledger comment). Functional input handling is NOT affected — commands
// still accept the real, full session id via --session/--cdpUrl; only
// DISPLAY of a session's own identity in non-functional output is redacted.

// fingerprintSessionId("cdp:eyJhbGciOi...") -> "cdp:...a1b2c3"
// fingerprintSessionId("agentcore:eyJhbGciOi...") -> "agentcore:...a1b2c3"
// Plain local ids (no ":") are returned unchanged — they carry no secret.
function fingerprintSessionId(id) {
  if (typeof id !== "string") return id;
  const idx = id.indexOf(":");
  if (idx < 0) return id;
  const provider = id.slice(0, idx);
  const token = id.slice(idx + 1);
  if (token.length <= 6) return `${provider}:...${token}`;
  return `${provider}:...${token.slice(-6)}`;
}

// Strips the query string (where SigV4 presigned auth lives — X-Amz-Signature,
// X-Amz-Credential, etc.) from any ws://, wss://, http:// or https:// URL
// found inside a message, and collapses any bare "<provider>:<token>"
// session id to its fingerprint. Used on every error message before it
// leaves the daemon (server.js) so a connectOverCDP failure, a decode
// failure, or any other error can never carry the presigned URL/signature
// or a full session token back to the caller/logs.
function sanitizeMessage(message) {
  if (typeof message !== "string") return message;
  let out = message.replace(
    /\b(wss?|https?):\/\/[^\s"')]+/gi,
    (url) => url.split("?")[0] + (url.includes("?") ? "?<redacted>" : "")
  );
  out = out.replace(/\b(cdp|agentcore|[a-z0-9-]{2,20}):[A-Za-z0-9_\-.]{20,}\b/gi, (m) =>
    fingerprintSessionId(m)
  );
  return out;
}

// User-agent policy for every session (local or provider-backed).
//
// Some browsers announce themselves as automation in the UA string:
//   - local headless Chromium:  "... HeadlessChrome/153.0.0.0 ..."
//   - Amazon Bedrock AgentCore: "... Chrome/148.0.0.0 Amazon-Bedrock-AgentCore-Browser/1.0
//                                 (Chromium; +https://docs.aws.amazon.com/...)"
// Bot-management edges (Imperva/Incapsula, Akamai, ...) key off those tokens
// and block the page's own API calls (403), so single-page apps render an
// empty shell (CBR-050: bcbsil's provider finder rendered 0 blocks in
// AgentCore; with the token stripped it renders fully from the same AWS IP).
//
// AUX4_BROWSER_USER_AGENT controls it:
//   unset / ""  -> normalize (strip the tokens above, keep everything else)
//   "keep"      -> leave the browser's own user agent untouched
//   any other   -> use that exact string as the user agent

const AUTOMATION_TOKENS = [
  // AgentCore's product token plus its "(Chromium; +https://...)" comment
  /\s*Amazon-Bedrock-AgentCore-Browser\/\S+(\s*\([^)]*\))?/g
];

function normalizeUserAgent(userAgent) {
  if (!userAgent) return userAgent;
  let ua = String(userAgent);
  for (const pattern of AUTOMATION_TOKENS) ua = ua.replace(pattern, "");
  ua = ua.replace(/HeadlessChrome\//g, "Chrome/").replace(/\s{2,}/g, " ").trim();
  // a stock Chrome UA always ends with the Safari token; keep that shape
  if (/ Chrome\/\S+$/.test(ua)) ua += " Safari/537.36";
  return ua;
}

// Returns the user agent to apply given the browser's own UA, or null when
// nothing should change.
function resolveUserAgent(browserUserAgent, setting = process.env.AUX4_BROWSER_USER_AGENT) {
  const mode = (setting || "").trim();
  if (mode.toLowerCase() === "keep") return null;
  if (mode) return mode === browserUserAgent ? null : mode;
  const normalized = normalizeUserAgent(browserUserAgent);
  return normalized && normalized !== browserUserAgent ? normalized : null;
}

// The browser's own user agent over CDP (Chromium only; null elsewhere).
async function browserUserAgent(browser) {
  if (!browser || typeof browser.newBrowserCDPSession !== "function") return null;
  let cdp;
  try {
    cdp = await browser.newBrowserCDPSession();
    const { userAgent } = await cdp.send("Browser.getVersion");
    return userAgent || null;
  } catch {
    return null;
  } finally {
    if (cdp) await cdp.detach().catch(() => {});
  }
}

// Apply a user agent to every current and future page of a context that we
// don't own (a provider's default context): per-page CDP override, re-applied
// on reattach since overrides live as long as our connection.
async function applyUserAgentToContext(context, userAgent) {
  if (!context || !userAgent) return;
  const apply = async (page) => {
    try {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.setUserAgentOverride", { userAgent });
    } catch {
      // page closed or target not CDP-capable; best-effort
    }
  };
  await Promise.all(context.pages().map(apply));
  context.on("page", apply);
}

// Where the daemon keeps its socket, pid file and artifacts.
//
// Default: ~/.aux4.config/browser. Override with AUX4_BROWSER_DIR. When the
// home directory is not writable (e.g. a read-only serverless/container
// filesystem where only the temp dir is writable), fall back to
// <tmpdir>/aux4-browser so the daemon can still create its unix socket.

function isWritableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveBrowserDir() {
  if (process.env.AUX4_BROWSER_DIR) return process.env.AUX4_BROWSER_DIR;
  const homeDir = path.join(os.homedir(), ".aux4.config", "browser");
  if (isWritableDir(homeDir)) return homeDir;
  return path.join(os.tmpdir(), "aux4-browser");
}

const BROWSER_DIR = resolveBrowserDir();
const SOCKET_PATH = path.join(BROWSER_DIR, "browser.sock");
const PID_PATH = path.join(BROWSER_DIR, "browser.pid");
const ARTIFACTS_DIR = path.join(BROWSER_DIR, "artifacts");

// Provider-backed session ids are "<provider>:<opaque token>" (e.g.
// "agentcore:eyJ...") so a session opened with --provider agentcore is
// self-describing: any process/daemon that later sees this id in --session
// can tell it's not a plain local id and knows which provider to ask to
// reattach, without any shared local state. Plain local ids never contain
// ":" (see open()), so this split is unambiguous.
function encodeSessionId(provider, token) {
  return `${provider}:${token}`;
}

// Built-in provider "cdp": attach to ANY remote Chromium over a CDP WebSocket
// URL the caller already holds (e.g. a short-lived presigned URL minted by a
// control plane that owns the remote session). No plugin, no vendor code, no
// credentials in this process: the token IS the base64url-encoded wsUrl, so the
// session id "cdp:<base64url(wsUrl)>" is self-contained and any fresh
// process/daemon can reattach with nothing but the id. Closing a cdp session
// only disconnects — the remote session's lifecycle belongs to whoever minted
// the URL.
const CDP_PROVIDER = "cdp";

function encodeCdpToken(wsUrl) {
  return Buffer.from(String(wsUrl), "utf-8").toString("base64url");
}

function decodeCdpToken(token) {
  const wsUrl = Buffer.from(String(token), "base64url").toString("utf-8");
  if (!/^wss?:\/\//.test(wsUrl)) throw new Error("browser provider \"cdp\": session token is not a ws:// or wss:// URL");
  return wsUrl;
}

async function disconnectQuietly(providerBrowser) {
  // For a connectOverCDP Browser, close() only drops our WebSocket (Playwright
  // closes the transport; it does not send Browser.close and does not close
  // the remote default context), so the remote session survives.
  if (!providerBrowser) return;
  try { await providerBrowser.close(); } catch {}
}

function decodeSessionId(id) {
  const idx = typeof id === "string" ? id.indexOf(":") : -1;
  if (idx === -1) return null;
  return { provider: id.slice(0, idx), token: id.slice(idx + 1) };
}

class SessionManager {
  constructor(getLocalBrowser, options = {}) {
    // The daemon's own local browser, used for provider="local" sessions
    // (the default). Provider-backed sessions (e.g. --provider agentcore)
    // each carry their OWN connection (session.providerBrowser) obtained via
    // the provider seam — see open()/resolveSession() and ProviderBridge.js.
    // Accepts either a Browser or an async getter (lazy launch, see
    // DaemonServer.ensureLocalBrowser).
    this.getLocalBrowser = typeof getLocalBrowser === "function"
      ? getLocalBrowser
      : async () => getLocalBrowser;
    this.sessions = new Map();
    this.maxSessions = options.maxSessions || 20;
    this.onEmpty = options.onEmpty || (() => {});
  }

  _writeArtifact(name, content, outputPath) {
    const dir = outputPath ? path.dirname(outputPath) : ARTIFACTS_DIR;
    fs.mkdirSync(dir, { recursive: true });
    const filePath = outputPath || path.join(ARTIFACTS_DIR, name);
    fs.writeFileSync(filePath, content, "utf-8");
    return filePath;
  }

  _contentSummary(content) {
    const lines = content.split("\n");
    const headings = lines.filter(l => /^#{1,3}\s/.test(l)).map(l => l.replace(/^#+\s*/, ""));
    const firstLine = lines.find(l => l.trim().length > 0) || "";
    return {
      headingCount: headings.length,
      firstHeading: headings[0] || "",
      preview: firstLine.slice(0, 120)
    };
  }

  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    this.resetTimer(session);
    return session;
  }

  // Like getSession, but for provider-backed ids (e.g. "agentcore:...") this
  // transparently reattaches when the id isn't tracked in THIS process/daemon
  // — the case a brand new daemon (previous one died, or a fresh cloud
  // invocation with no shared disk) hits when it receives --session for a
  // session that started somewhere else. It NEVER falls back to a local
  // browser: a provider-prefixed id that fails to reattach throws loudly, and
  // a plain local id that isn't tracked here throws "Session not found" same
  // as before (see CBR-007/CBR-008).
  async resolveSession(sessionId) {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      this.resetTimer(existing);
      return existing;
    }

    const decoded = decodeSessionId(sessionId);
    if (!decoded) throw new Error(`Session not found: ${sessionId}`);

    const { provider, token } = decoded;
    let wsUrl;
    let headers;
    if (provider === CDP_PROVIDER) {
      wsUrl = decodeCdpToken(token);
      headers = {};
    } else {
      ({ wsUrl, headers } = await ProviderBridge.attach(provider, { token }));
      if (!wsUrl) throw new Error(`browser provider "${provider}" attach did not return a wsUrl`);
    }

    const providerBrowser = await BrowserEngine.connect(wsUrl, headers || {});
    const context = providerBrowser.contexts()[0] || await providerBrowser.newContext();
    await this._applyRemoteUserAgent(providerBrowser, context);
    const page = context.pages()[0] || await context.newPage();

    const timeout = this.parseTimeout("10m");
    const session = {
      id: sessionId, context, pages: [page], activeTab: 0,
      timeout, createdAt: Date.now(), lastActivity: Date.now(), timer: null,
      outputDir: "", videoMode: "off", hadError: false, snapshotMode: "off",
      remote: true, provider, providerToken: token, providerBrowser
    };
    session.timer = setTimeout(() => this.close(sessionId), timeout);

    this.sessions.set(sessionId, session);
    return session;
  }

  getBase(session, params = {}) {
    const page = session.pages[session.activeTab];
    // --within scopes subsequent locators INSIDE an iframe via frameLocator,
    // which (unlike page.locator on the iframe element) can reach the frame's
    // document and dispatches real, auto-waited events. Supports nested frames
    // by splitting the selector on ">>>".
    let base = page;
    const within = params.within;
    if (within) {
      for (const sel of String(within).split(">>>").map(s => s.trim()).filter(Boolean)) {
        base = base.frameLocator(sel);
      }
    }
    return session.scope ? base.locator(session.scope) : base;
  }

  async setScope(sessionId, selector) {
    const session = await this.resolveSession(sessionId);
    if (!session.scopeStack) session.scopeStack = [];
    if (session.scope) session.scopeStack.push(session.scope);
    session.scope = selector;
    return { status: "ok", scope: selector };
  }

  async setSnapshot(sessionId, mode) {
    const session = await this.resolveSession(sessionId);
    session.snapshotMode = mode || "off";
    return { status: "ok", snapshot: session.snapshotMode };
  }

  async clearScope(sessionId) {
    const session = await this.resolveSession(sessionId);
    if (!session.scopeStack) session.scopeStack = [];
    session.scope = session.scopeStack.pop() || null;
    return { status: "ok" };
  }

  resetTimer(session) {
    clearTimeout(session.timer);
    session.lastActivity = Date.now();
    session.timer = setTimeout(() => this.close(session.id), session.timeout);
  }

  parseTimeout(str) {
    if (!str) return 600000;
    const match = String(str).match(/^(\d+)(ms|s|m|h)?$/);
    if (!match) return 600000;
    const val = parseInt(match[1]);
    switch (match[2]) {
      case "ms": return val;
      case "s": return val * 1000;
      case "h": return val * 3600000;
      case "m": default: return val * 60000;
    }
  }

  async _navigate(page, url, waitUntil) {
    const strategy = waitUntil || "load";
    let response;
    if (strategy === "settle") {
      response = await page.goto(url, { waitUntil: "domcontentloaded" });
      await this._waitForSettle(page);
    } else {
      response = await page.goto(url, { waitUntil: strategy });
    }
    if (strategy !== "commit") await this._waitForContent(page);
    return response;
  }

  // Single-page apps often reach "load" with an empty <body> and render a
  // few seconds later (their API calls are still in flight). Wait until the
  // page shows some rendered text — in the main document, an open shadow
  // root or a child frame — capped (AUX4_BROWSER_CONTENT_WAIT ms, default
  // 8000; 0 disables). A static page with no scripts that is genuinely empty
  // returns immediately.
  async _waitForContent(page) {
    const raw = process.env.AUX4_BROWSER_CONTENT_WAIT;
    const cap = raw === undefined || raw === "" ? 8000 : parseInt(raw);
    if (!cap || cap <= 0) return;
    const hasContent = () => {
      const body = document.body;
      if (!body) return false;
      if ((body.innerText || "").trim().length > 0) return true;
      const hosts = [...document.querySelectorAll("*")].filter(el => el.shadowRoot);
      if (hosts.some(el => (el.shadowRoot.textContent || "").trim().length > 0)) return true;
      if (document.querySelector("iframe")) return "frames";
      if (!document.querySelector("script")) return "static";
      return false;
    };
    const deadline = Date.now() + cap;
    try {
      while (Date.now() < deadline) {
        const state = await page.evaluate(hasContent).catch(() => false);
        if (state === true || state === "static") return;
        if (state === "frames") {
          for (const frame of page.frames()) {
            if (frame === page.mainFrame()) continue;
            const text = await frame.evaluate(() => (document.body?.innerText || "").trim().length).catch(() => 0);
            if (text > 0) return;
          }
        }
        await page.waitForTimeout(250);
      }
    } catch {
      // navigation in progress / page closed; content wait is best-effort
    }
  }

  // User agent for new local contexts (see UserAgent.js): the local browser's
  // own UA normalized (HeadlessChrome -> Chrome) unless configured otherwise.
  async _localUserAgent(localBrowser) {
    if (this._localUserAgentCache === undefined) {
      const own = await browserUserAgent(localBrowser);
      this._localUserAgentCache = own ? resolveUserAgent(own) : resolveUserAgent("", process.env.AUX4_BROWSER_USER_AGENT);
    }
    return this._localUserAgentCache;
  }

  // Provider-backed sessions reuse the provider's default context, so the UA
  // is overridden per page over CDP on every (re)attach.
  async _applyRemoteUserAgent(providerBrowser, context) {
    const own = await browserUserAgent(providerBrowser);
    const userAgent = resolveUserAgent(own || "");
    if (userAgent) await applyUserAgentToContext(context, userAgent);
  }

  async _waitForSettle(page, quietMs = 300) {
    try {
      await page.evaluate((ms) => {
        return new Promise((resolve) => {
          let timer = setTimeout(resolve, ms);
          const observer = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => { observer.disconnect(); resolve(); }, ms);
          });
          observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        });
      }, quietMs);
    } catch {
      // page may have navigated away; settle is best-effort
    }
  }

  _pageInfo(page, response) {
    const info = { finalUrl: page.url() };
    if (response) {
      info.httpStatus = response.status();
    }
    return info;
  }

  async _pageInfoAsync(page, response) {
    const info = this._pageInfo(page, response);
    try { info.title = await page.title(); } catch { info.title = ""; }
    return info;
  }

  async open(params = {}) {
    if (this.sessions.size >= this.maxSessions) {
      throw new Error(`Max sessions (${this.maxSessions}) reached`);
    }

    const provider = params.provider && params.provider !== "local" ? params.provider : "local";
    const timeout = this.parseTimeout(params.timeout || "10m");
    const outputDir = params.output || "";
    const videoMode = params.video || "off";

    let id;
    let context;
    let page;
    let providerBrowser = null;

    if (provider !== "local") {
      // Provider seam: core knows nothing about the provider beyond
      // "give me a wsUrl+headers to connectOverCDP, and an opaque token I can
      // hand back to reattach/close later." See ProviderBridge.js.
      let opened;
      if (provider === CDP_PROVIDER) {
        if (!params.cdpUrl) throw new Error(`browser provider "cdp" requires --cdpUrl <ws(s)://...>`);
        opened = { token: encodeCdpToken(params.cdpUrl), wsUrl: params.cdpUrl, headers: {} };
        decodeCdpToken(opened.token);
      } else {
        opened = await ProviderBridge.open(provider, {
          awsProfile: params.awsProfile,
          awsRegion: params.awsRegion,
          timeout: params.timeout
        });
      }
      if (!opened.token || !opened.wsUrl) {
        throw new Error(`browser provider "${provider}" open did not return a token/wsUrl`);
      }
      providerBrowser = await BrowserEngine.connect(opened.wsUrl, opened.headers || {});
      // Reuse the remote browser's existing default context/page (created by
      // the provider, not by us) instead of creating a fresh one per aux4
      // "session" — providers like AgentCore allow exactly one automation
      // stream per session, and the whole point is to survive detach/
      // reattach across process invocations.
      context = providerBrowser.contexts()[0];
      if (!context) context = await providerBrowser.newContext();
      await this._applyRemoteUserAgent(providerBrowser, context);
      page = context.pages()[0];
      if (!page) page = await context.newPage();
      id = encodeSessionId(provider, opened.token);
    } else {
      const contextOptions = {
        viewport: {
          width: parseInt(params.width) || 1280,
          height: parseInt(params.height) || 720
        }
      };
      if (outputDir && videoMode !== "off") {
        const videoDir = path.join(outputDir, "videos");
        fs.mkdirSync(videoDir, { recursive: true });
        contextOptions.recordVideo = { dir: videoDir };
      }
      const localBrowser = await this.getLocalBrowser();
      const userAgent = await this._localUserAgent(localBrowser);
      if (userAgent) contextOptions.userAgent = userAgent;
      context = await localBrowser.newContext(contextOptions);
      page = await context.newPage();
      id = crypto.randomUUID().slice(0, 8);
    }

    let response = null;
    if (params.url && params.url !== "") {
      response = await this._navigate(page, params.url, params.waitUntil);
    }

    const snapshotMode = params.snapshot || "off";
    const session = {
      id, context, pages: [page], activeTab: 0,
      timeout, createdAt: Date.now(), lastActivity: Date.now(),
      timer: setTimeout(() => this.close(id), timeout),
      outputDir, videoMode, hadError: false, snapshotMode,
      remote: provider !== "local",
      provider: provider !== "local" ? provider : null,
      providerToken: provider !== "local" ? id.slice(provider.length + 1) : null,
      providerBrowser
    };

    this.sessions.set(id, session);
    const result = { sessionId: id, ...(await this._pageInfoAsync(page, response)) };
    await this._attachSnapshot(session, result);
    return result;
  }

  async _attachSnapshot(session, result, overrideMode) {
    const mode = overrideMode || session.snapshotMode;
    if (!mode || mode === "off") return result;
    try {
      const page = session.pages[session.activeTab];
      const snapshot = await SnapshotBuilder.build(page, mode);
      if (snapshot) result.snapshot = snapshot;
    } catch (e) {
      result.snapshotError = e.message;
    }
    return result;
  }

  async screenshotOnError(session) {
    if (!session.outputDir) return null;
    try {
      fs.mkdirSync(session.outputDir, { recursive: true });
      const filename = `error-${Date.now()}.png`;
      const filepath = path.join(session.outputDir, filename);
      const page = session.pages[session.activeTab];
      await page.screenshot({ path: filepath });
      session.hadError = true;
      return filepath;
    } catch {
      return null;
    }
  }

  // options.detach: true means "stop tracking locally only" — used when the
  // local daemon itself is shutting down (server.stop()/closeAll()), where a
  // provider-backed session must survive so a LATER process can reattach to
  // the same --session id. False (the default, used by the explicit `browser
  // close --session` command) means a real close: for provider sessions that
  // calls the provider's own close/stop, ending the remote session for good.
  async close(sessionId, options = {}) {
    const detach = options.detach || false;
    // resolveSession (not the plain map lookup) so `close --session <id>` on
    // a provider session works even from a brand new daemon that never saw
    // `open` for this id — it reattaches first, then closes for real.
    const session = await this.resolveSession(sessionId);
    clearTimeout(session.timer);

    if (session.remote) {
      const stopRemote = !detach && session.provider !== CDP_PROVIDER;
      if (stopRemote) {
        await ProviderBridge.close(session.provider, { token: session.providerToken });
      }
      await disconnectQuietly(session.providerBrowser);
      this.sessions.delete(sessionId);
      if (this.sessions.size === 0) this.onEmpty();
      return { status: stopRemote ? "closed" : "detached" };
    }

    // Collect video paths before closing context
    const videoPaths = [];
    if (session.videoMode === "retain-on-failure" && !session.hadError) {
      for (const page of session.pages) {
        try {
          const vpath = await page.video()?.path();
          if (vpath) videoPaths.push(vpath);
        } catch {}
      }
    }

    await session.context.close();

    // Clean up video on success for retain-on-failure mode
    for (const vpath of videoPaths) {
      try { if (fs.existsSync(vpath)) fs.unlinkSync(vpath); } catch {}
    }

    this.sessions.delete(sessionId);
    if (this.sessions.size === 0) this.onEmpty();
    return { status: "closed" };
  }

  // Status listing (CBR-015): the caller already holds every real session id
  // it opened, so a "which sessions are active" display never needs to
  // re-print the full provider-backed id (a bearer credential for "cdp"
  // sessions) — a short fingerprint is enough to recognize it.
  list() {
    const result = [];
    for (const [id, session] of this.sessions) {
      const activePage = session.pages[session.activeTab];
      result.push({
        id: fingerprintSessionId(id), url: activePage ? activePage.url() : "",
        tabs: session.pages.length, createdAt: session.createdAt
      });
    }
    return result;
  }

  async visit(sessionId, url, waitUntil) {
    const session = await this.resolveSession(sessionId);
    const page = session.pages[session.activeTab];
    const response = await this._navigate(page, url, waitUntil);
    const info = await this._pageInfoAsync(page, response);
    return this._attachSnapshot(session, { status: "ok", ...info });
  }

  async back(sessionId) {
    const session = await this.resolveSession(sessionId);
    const page = session.pages[session.activeTab];
    await page.goBack();
    return this._attachSnapshot(session, { status: "ok", url: page.url() });
  }

  async forward(sessionId) {
    const session = await this.resolveSession(sessionId);
    const page = session.pages[session.activeTab];
    await page.goForward();
    return this._attachSnapshot(session, { status: "ok", url: page.url() });
  }

  async reload(sessionId) {
    const session = await this.resolveSession(sessionId);
    const page = session.pages[session.activeTab];
    await page.reload();
    return this._attachSnapshot(session, { status: "ok", url: page.url() });
  }

  async _clickWithTimeout(session, locator, timeout, description) {
    try {
      await locator.click({ timeout });
      return this._attachSnapshot(session, { status: "ok" });
    } catch (e) {
      if (e.message && e.message.includes("Timeout")) {
        const page = session.pages[session.activeTab];
        return {
          clicked: false,
          reason: "timeout",
          description,
          timeout,
          currentUrl: page.url(),
          title: await page.title().catch(() => "")
        };
      }
      throw e;
    }
  }

  // Resolve a snapshot ref index (as produced by the `snapshot` command) to a
  // live Playwright ElementHandle, using the same interactive-role walk as
  // click()'s ref branch. Shared by type/select/check/uncheck so --ref works
  // consistently across all element-targeting commands, not just click.
  async _resolveRefElement(session, ref) {
    const page = session.pages[session.activeTab];
    const targetRef = parseInt(ref);
    const handle = await page.evaluateHandle((targetRef) => {
      const INTERACTIVE_ROLES = [
        "button", "link", "textbox", "checkbox", "radio", "combobox", "listbox",
        "menuitem", "tab", "switch", "searchbox", "slider", "spinbutton", "option"
      ];
      const COMPONENT_ROLES = ["table", "form", "list", "navigation", "menu", "dialog", "tablist", "tree"];
      const implicitRole = (el) => {
        const tag = el.tagName.toLowerCase();
        switch (tag) {
          case "a": return el.hasAttribute("href") ? "link" : null;
          case "button": return "button";
          case "input": {
            const type = (el.getAttribute("type") || "text").toLowerCase();
            if (type === "checkbox") return "checkbox";
            if (type === "radio") return "radio";
            if (type === "submit" || type === "button" || type === "reset") return "button";
            if (type === "range") return "slider";
            if (type === "number") return "spinbutton";
            if (type === "search") return "searchbox";
            return "textbox";
          }
          case "textarea": return "textbox";
          case "select": return "combobox";
          case "nav": return "navigation";
          case "table": return "table";
          case "form": return "form";
          case "ul": case "ol": return "list";
          case "dialog": return "dialog";
          case "option": return "option";
          default: return null;
        }
      };
      const isVisible = (el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(el);
        return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
      };
      const allRoles = [...INTERACTIVE_ROLES, ...COMPONENT_ROLES];
      let ref = 0;
      for (const el of (() => { const out = []; const walk = (root) => { for (const el of root.querySelectorAll("*")) { out.push(el); if (el.shadowRoot) walk(el.shadowRoot); } }; walk(document); return out; })()) {
        const role = el.getAttribute("role") || implicitRole(el);
        if (!role || !allRoles.includes(role)) continue;
        if (!isVisible(el)) continue;
        ref++;
        if (ref === targetRef) return el;
      }
      return null;
    }, targetRef);
    const element = handle.asElement();
    if (!element) {
      await handle.dispose();
      throw new Error(`Snapshot ref [${targetRef}] not found on page`);
    }
    return element;
  }

  async click(sessionId, params) {
    const session = await this.resolveSession(sessionId);
    const timeout = parseInt(params.timeout) || 5000;

    // Click by snapshot ref index
    if (params.ref != null) {
      const page = session.pages[session.activeTab];
      const ref = parseInt(params.ref);
      const clicked = await page.evaluate((targetRef) => {
        const INTERACTIVE_ROLES = [
          "button", "link", "textbox", "checkbox", "radio", "combobox", "listbox",
          "menuitem", "tab", "switch", "searchbox", "slider", "spinbutton", "option"
        ];
        const COMPONENT_ROLES = ["table", "form", "list", "navigation", "menu", "dialog", "tablist", "tree"];
        const implicitRole = (el) => {
          const tag = el.tagName.toLowerCase();
          switch (tag) {
            case "a": return el.hasAttribute("href") ? "link" : null;
            case "button": return "button";
            case "input": {
              const type = (el.getAttribute("type") || "text").toLowerCase();
              if (type === "checkbox") return "checkbox";
              if (type === "radio") return "radio";
              if (type === "submit" || type === "button" || type === "reset") return "button";
              if (type === "range") return "slider";
              if (type === "number") return "spinbutton";
              if (type === "search") return "searchbox";
              return "textbox";
            }
            case "textarea": return "textbox";
            case "select": return "combobox";
            case "nav": return "navigation";
            case "table": return "table";
            case "form": return "form";
            case "ul": case "ol": return "list";
            case "dialog": return "dialog";
            case "option": return "option";
            default: return null;
          }
        };
        const isVisible = (el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return false;
          const style = window.getComputedStyle(el);
          return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
        };
        const allRoles = [...INTERACTIVE_ROLES, ...COMPONENT_ROLES];
        let ref = 0;
        for (const el of (() => { const out = []; const walk = (root) => { for (const el of root.querySelectorAll("*")) { out.push(el); if (el.shadowRoot) walk(el.shadowRoot); } }; walk(document); return out; })()) {
          const role = el.getAttribute("role") || implicitRole(el);
          if (!role || !allRoles.includes(role)) continue;
          if (!isVisible(el)) continue;
          ref++;
          if (ref === targetRef) {
            el.click();
            return true;
          }
        }
        return false;
      }, ref);
      if (!clicked) throw new Error(`Snapshot ref [${ref}] not found on page`);
      return this._attachSnapshot(session, { status: "ok" });
    }

    const base = this.getBase(session, params);
    const role = params.role || "button";
    const locator = base.getByRole(role, { name: params.name });
    const index = params.index != null ? parseInt(params.index) - 1 : 0;
    return this._clickWithTimeout(session, locator.nth(index), timeout, `role=${role} name="${params.name}"`);
  }

  async clickSelector(sessionId, params) {
    const session = await this.resolveSession(sessionId);
    const base = this.getBase(session, params);
    const timeout = parseInt(params.timeout) || 5000;
    return this._clickWithTimeout(session, base.locator(params.selector).first(), timeout, `selector="${params.selector}"`);
  }

  // Drive the real mouse via CDP at viewport coordinates, with a human-like
  // multi-step trajectory. Unlike locator.click() (which teleports to the
  // element), this moves the cursor through intermediate points so behavioral
  // bot-detection sees natural movement. Works across iframes because it
  // targets page-space coordinates, not a frame-scoped element.
  async mouse(sessionId, params) {
    const session = await this.resolveSession(sessionId);
    const page = session.pages[session.activeTab];
    const action = params.action || "click";
    let x = parseFloat(params.x);
    let y = parseFloat(params.y);
    // When a selector is given, resolve the element's page-space box (honoring
    // --within for iframes) and aim at its center, so callers can mouse-click an
    // element by selector without computing coordinates themselves.
    if (params.selector) {
      const base = this.getBase(session, params);
      const box = await base.locator(params.selector).first().boundingBox({ timeout: parseInt(params.timeout) || 5000 });
      if (!box) return { status: "error", reason: "selector not found", selector: params.selector };
      x = box.x + box.width / 2;
      y = box.y + box.height / 2;
    }
    const steps = parseInt(params.steps) || 20;
    if (action === "move") {
      await page.mouse.move(x, y, { steps });
    } else if (action === "down") {
      await page.mouse.down();
    } else if (action === "up") {
      await page.mouse.up();
    } else {
      // click: glide to the point over several steps, then press
      await page.mouse.move(x, y, { steps });
      await page.mouse.down();
      await page.mouse.up();
    }
    return { status: "ok", action, x: Math.round(x), y: Math.round(y) };
  }

  async clickText(sessionId, params) {
    const session = await this.resolveSession(sessionId);
    const base = this.getBase(session, params);
    const locator = base.getByText(params.text, { exact: false });
    const index = params.index != null ? parseInt(params.index) - 1 : 0;
    const timeout = parseInt(params.timeout) || 5000;
    return this._clickWithTimeout(session, locator.nth(index), timeout, `text="${params.text}"`);
  }

  async type(sessionId, params) {
    const session = await this.resolveSession(sessionId);
    if (params.ref != null && params.ref !== "") {
      const element = await this._resolveRefElement(session, params.ref);
      await element.fill(params.value);
      await element.dispose();
      return this._attachSnapshot(session, { status: "ok" });
    }
    const base = this.getBase(session, params);
    const role = params.role || "textbox";
    await base.getByRole(role, { name: params.name }).fill(params.value);
    return this._attachSnapshot(session, { status: "ok" });
  }

  async scroll(sessionId, params) {
    const session = await this.resolveSession(sessionId);
    const page = session.pages[session.activeTab];
    if (params.to) {
      const base = this.getBase(session, params);
      await base.getByText(params.to, { exact: false }).first().scrollIntoViewIfNeeded({ timeout: parseInt(params.timeout) || 5000 });
    } else if (params.direction === "top") {
      await page.evaluate(() => window.scrollTo(0, 0));
    } else if (params.direction === "bottom") {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    } else {
      const amount = parseInt(params.amount) || 500;
      const dy = params.direction === "up" ? -amount : amount;
      await page.evaluate((d) => window.scrollBy(0, d), dy);
    }
    return this._attachSnapshot(session, { status: "ok" });
  }

  async content(sessionId, params) {
    const session = await this.resolveSession(sessionId);
    const page = session.pages[session.activeTab];
    const result = await ContentExtractor.extract(page, params);

    if (params.output) {
      const filePath = this._writeArtifact(
        `content-${sessionId}-${Date.now()}.md`,
        result.content,
        params.output
      );
      return {
        status: "ok",
        path: filePath,
        contentLength: result.content.length,
        ...this._contentSummary(result.content),
        ...(result.warning ? { warning: result.warning } : {})
      };
    }

    return result;
  }

  async read(params = {}) {
    const url = params.url;
    if (!url) throw new Error("read: --url is required");
    const format = params.format || "markdown";
    const waitUntil = params.waitUntil || "load";

    // Reuse existing session if one is already open, otherwise create one
    let sessionId = params.session;
    let created = false;
    if (!sessionId) {
      const openResult = await this.open({ snapshot: "off" });
      sessionId = openResult.sessionId;
      created = true;
    }

    const session = await this.resolveSession(sessionId);
    const page = session.pages[session.activeTab];
    const response = await this._navigate(page, url, waitUntil);
    const info = await this._pageInfoAsync(page, response);
    const { content, warning } = await ContentExtractor.extract(page, { format });

    if (params.output) {
      const filePath = this._writeArtifact(
        `read-${sessionId}-${Date.now()}.md`,
        content,
        params.output
      );
      const result = { status: "ok", ...info, path: filePath, contentLength: content.length, ...this._contentSummary(content) };
      if (warning) result.warning = warning;
      if (created) { await this.close(sessionId); result.sessionClosed = true; }
      else { result.sessionId = sessionId; }
      return result;
    }

    const result = { status: "ok", ...info, content };
    if (warning) result.warning = warning;
    if (created) {
      await this.close(sessionId);
      result.sessionClosed = true;
    } else {
      result.sessionId = sessionId;
    }
    return result;
  }

  async screenshot(sessionId, params) {
    const session = await this.resolveSession(sessionId);
    const page = session.pages[session.activeTab];
    const options = { path: params.output || "screenshot.png" };
    if (params.fullPage === "true" || params.fullPage === true) options.fullPage = true;
    await page.screenshot(options);
    return { status: "ok", path: options.path };
  }

  async wait(sessionId, params) {
    const session = await this.resolveSession(sessionId);
    const page = session.pages[session.activeTab];
    const timeout = parseInt(params.timeout) || 10000;
    const selector = params.selector || "";

    try {
      // networkidle mode
      if (selector === "networkidle") {
        await page.waitForLoadState("networkidle", { timeout });
        return { status: "ok", mode: "networkidle" };
      }

      // url= mode: wait for URL to match
      if (selector.startsWith("url=")) {
        const pattern = selector.slice(4);
        await page.waitForURL(`**${pattern}**`, { timeout });
        return { status: "ok", mode: "url", url: page.url() };
      }

      // text= mode: wait for text to appear
      if (selector.startsWith("text=")) {
        const text = selector.slice(5);
        const base = this.getBase(session, params);
        await base.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
        return { status: "ok", mode: "text" };
      }

      // settle mode: wait for DOM to stop mutating
      if (selector === "settle") {
        await this._waitForSettle(page, 300);
        return { status: "ok", mode: "settle" };
      }

      // Default: CSS selector
      const base = this.getBase(session, params);
      await base.locator(selector).first().waitFor({ state: "visible", timeout });
      return { status: "ok" };
    } catch (e) {
      if (e.message && e.message.includes("Timeout")) {
        const title = await page.title().catch(() => "");
        return {
          timedOut: true,
          waitedFor: selector,
          timeout,
          currentUrl: page.url(),
          title,
          visibleHeadings: await page.locator("h1, h2, h3").count().catch(() => 0)
        };
      }
      throw e;
    }
  }

  async expect(sessionId, params) {
    const session = await this.resolveSession(sessionId);
    const page = session.pages[session.activeTab];
    const base = this.getBase(session, params);
    const timeout = parseInt(params.timeout) || 5000;
    const locator = base.locator(params.selector);

    if (params.assertion === "have_text") {
      const deadline = Date.now() + timeout;
      let text = "";
      while (Date.now() < deadline) {
        text = await locator.first().textContent({ timeout: Math.max(deadline - Date.now(), 1000) }).catch(() => "") || "";
        if (text.includes(params.expected)) return { status: "ok", text };
        await new Promise(r => setTimeout(r, 250));
      }
      throw new Error(`Expected "${params.selector}" to have text "${params.expected}", but got "${text}"`);
    }

    if (params.assertion === "be_visible") {
      const visible = await locator.first().isVisible({ timeout });
      if (!visible) {
        throw new Error(`Expected "${params.selector}" to be visible`);
      }
      return { status: "ok" };
    }

    if (params.assertion === "exist") {
      const count = await locator.count();
      if (count === 0) {
        throw new Error(`Expected "${params.selector}" to exist`);
      }
      return { status: "ok", count };
    }

    if (params.assertion === "not_exist") {
      const count = await locator.count();
      if (count > 0) {
        throw new Error(`Expected "${params.selector}" to not exist, but found ${count}`);
      }
      return { status: "ok" };
    }

    if (params.assertion === "have_attribute") {
      const [attr, expected] = (params.expected || "").split("=", 2);
      const value = await locator.first().getAttribute(attr, { timeout });
      if (expected !== undefined && value !== expected) {
        throw new Error(`Expected "${params.selector}" attribute "${attr}" to be "${expected}", but got "${value}"`);
      }
      if (value === null) {
        throw new Error(`Expected "${params.selector}" to have attribute "${attr}"`);
      }
      return { status: "ok", attribute: attr, value };
    }

    if (params.assertion === "have_count") {
      const expected = parseInt(params.expected) || 0;
      const count = await locator.count();
      if (count !== expected) {
        throw new Error(`Expected "${params.selector}" to have count ${expected}, but got ${count}`);
      }
      return { status: "ok", count };
    }

    if (params.assertion === "have_count_at_least") {
      const expected = parseInt(params.expected) || 0;
      await locator.nth(expected - 1).waitFor({ state: "attached", timeout });
      const count = await locator.count();
      return { status: "ok", count };
    }

    if (params.assertion === "have_url") {
      const url = page.url();
      if (!url.includes(params.expected)) {
        throw new Error(`Expected URL to contain "${params.expected}", but got "${url}"`);
      }
      return { status: "ok", url };
    }

    if (params.assertion === "have_title") {
      const title = await page.title();
      if (!title.includes(params.expected)) {
        throw new Error(`Expected title to contain "${params.expected}", but got "${title}"`);
      }
      return { status: "ok", title };
    }

    throw new Error(`Unknown assertion: ${params.assertion}`);
  }

  async select(sessionId, params) {
    const session = await this.resolveSession(sessionId);
    const timeout = parseInt(params.timeout) || 5000;
    if (params.ref != null && params.ref !== "") {
      const element = await this._resolveRefElement(session, params.ref);
      try {
        await this._selectOn(session, element, params.value, timeout);
      } finally {
        await element.dispose();
      }
      return this._attachSnapshot(session, { status: "ok" });
    }
    const base = this.getBase(session, params);
    const role = params.role || "combobox";
    const locator = base.getByRole(role, { name: params.name }).first();
    const element = await locator.elementHandle({ timeout });
    try {
      await this._selectOn(session, element, params.value, timeout);
    } finally {
      await element.dispose();
    }
    return this._attachSnapshot(session, { status: "ok" });
  }

  // A native <select> takes selectOption. A custom combobox (a div/mat-select/
  // listbox button with role=combobox) cannot: open it with a click, then click
  // the visible role=option whose text matches the value (exact, then
  // case-insensitive contains).
  async _selectOn(session, element, value, timeout) {
    const tag = await element.evaluate(el => el.tagName.toLowerCase());
    if (tag === "select") {
      await element.selectOption(value, { timeout });
      return;
    }
    const page = session.pages[session.activeTab];
    await element.click({ timeout });
    const wanted = String(value == null ? "" : value).trim();
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const clicked = await page.evaluate((wanted) => {
        const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          const s = window.getComputedStyle(el);
          return s.visibility !== "hidden" && s.display !== "none";
        };
        const options = Array.from(document.querySelectorAll("[role='option']")).filter(visible);
        const w = norm(wanted);
        const pick = options.find(o => norm(o.textContent) === w)
          || options.find(o => norm(o.getAttribute("aria-label")) === w)
          || options.find(o => w && norm(o.textContent).includes(w));
        if (!pick) return options.length ? "none" : "";
        pick.scrollIntoView({ block: "center" });
        pick.setAttribute("data-aux4-select-pick", "1");
        return "ok";
      }, wanted);
      if (clicked === "ok") {
        const pick = page.locator("[data-aux4-select-pick='1']").first();
        await pick.click({ timeout });
        await page.evaluate(() => document.querySelectorAll("[data-aux4-select-pick]").forEach(el => el.removeAttribute("data-aux4-select-pick")));
        return;
      }
      if (clicked === "none") {
        await page.keyboard.press("Escape").catch(() => {});
        throw new Error(`select: no option matching "${wanted}"`);
      }
      await page.waitForTimeout(150);
    }
    await page.keyboard.press("Escape").catch(() => {});
    throw new Error(`select: the combobox did not show any options for "${wanted}"`);
  }

  async check(sessionId, params) {
    const session = await this.resolveSession(sessionId);
    if (params.ref != null && params.ref !== "") {
      const element = await this._resolveRefElement(session, params.ref);
      await element.check({ timeout: parseInt(params.timeout) || 5000 });
      await element.dispose();
      return this._attachSnapshot(session, { status: "ok" });
    }
    const base = this.getBase(session, params);
    const role = params.role || "checkbox";
    await base.getByRole(role, { name: params.name }).check({ timeout: parseInt(params.timeout) || 5000 });
    return this._attachSnapshot(session, { status: "ok" });
  }

  async uncheck(sessionId, params) {
    const session = await this.resolveSession(sessionId);
    if (params.ref != null && params.ref !== "") {
      const element = await this._resolveRefElement(session, params.ref);
      await element.uncheck({ timeout: parseInt(params.timeout) || 5000 });
      await element.dispose();
      return this._attachSnapshot(session, { status: "ok" });
    }
    const base = this.getBase(session, params);
    const role = params.role || "checkbox";
    await base.getByRole(role, { name: params.name }).uncheck({ timeout: parseInt(params.timeout) || 5000 });
    return this._attachSnapshot(session, { status: "ok" });
  }

  async hover(sessionId, params) {
    const session = await this.resolveSession(sessionId);
    const base = this.getBase(session, params);
    const role = params.role || "button";
    await base.getByRole(role, { name: params.name }).hover({ timeout: parseInt(params.timeout) || 5000 });
    return this._attachSnapshot(session, { status: "ok" });
  }

  async press(sessionId, params) {
    const session = await this.resolveSession(sessionId);
    const page = session.pages[session.activeTab];
    if (params.selector) {
      const base = this.getBase(session, params);
      await base.locator(params.selector).first().focus({ timeout: parseInt(params.timeout) || 5000 });
    }
    await page.keyboard.press(params.key);
    return this._attachSnapshot(session, { status: "ok" });
  }

  async clear(sessionId, params) {
    const session = await this.resolveSession(sessionId);
    const base = this.getBase(session, params);
    const role = params.role || "textbox";
    await base.getByRole(role, { name: params.name }).clear({ timeout: parseInt(params.timeout) || 5000 });
    return { status: "ok" };
  }

  async upload(sessionId, params) {
    const session = await this.resolveSession(sessionId);
    const base = this.getBase(session, params);
    await base.getByLabel(params.name).setInputFiles(params.file, { timeout: parseInt(params.timeout) || 5000 });
    return { status: "ok" };
  }

  async evaluate(sessionId, script) {
    const session = await this.resolveSession(sessionId);
    const page = session.pages[session.activeTab];
    const result = await page.evaluate(script);
    return { result };
  }

  async cookies(sessionId, params) {
    const session = await this.resolveSession(sessionId);
    if (params.export && params.export !== "") {
      const cookies = await session.context.cookies();
      fs.writeFileSync(params.export, JSON.stringify(cookies, null, 2));
      return { status: "exported", path: params.export, count: cookies.length };
    }
    if (params.import && params.import !== "") {
      const cookies = JSON.parse(fs.readFileSync(params.import, "utf-8"));
      await session.context.addCookies(cookies);
      return { status: "imported", count: cookies.length };
    }
    const cookies = await session.context.cookies();
    return { cookies };
  }

  // Playwright storageState ({cookies, origins:[{origin, localStorage}]}) —
  // the "logged-in-ness" of a session, so a later session (possibly a brand
  // new remote browser) can pick up where this one left off. The state IS a
  // credential (session cookies), so it only ever goes to a file (mode 0600);
  // the daemon's response carries counts only, never the state itself.
  async stateSave(sessionId, params = {}) {
    const session = await this.resolveSession(sessionId);
    const output = params.output || "";
    if (!output) throw new Error("state save: --output <file> is required");
    const state = await session.context.storageState();
    const summary = {
      cookies: (state.cookies || []).length,
      origins: (state.origins || []).length
    };
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(state), { mode: 0o600 });
    fs.chmodSync(output, 0o600);
    return { status: "saved", path: output, ...summary };
  }

  // Apply a storageState to an EXISTING session: cookies via addCookies, and
  // localStorage via an init script that seeds each saved origin's keys the
  // first time a page of that origin loads (keys the page already has are
  // left alone, so the app's own later writes are never clobbered). The
  // current page is seeded too when its origin matches. Works the same on a
  // local context and a provider-attached (CDP) one.
  async stateLoad(sessionId, params = {}) {
    const session = await this.resolveSession(sessionId);
    const file = params.file || "";
    if (!file) throw new Error("state load: --file <file> is required");
    let state;
    try {
      state = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch (e) {
      throw new Error(`state load: cannot read storage state from ${file}: ${e.code || "invalid JSON"}`);
    }
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      throw new Error("state load: file is not a storage state object ({cookies, origins})");
    }
    const cookies = Array.isArray(state.cookies) ? state.cookies : [];
    const origins = (Array.isArray(state.origins) ? state.origins : [])
      .filter(o => o && typeof o.origin === "string" && Array.isArray(o.localStorage));

    if (cookies.length) await session.context.addCookies(cookies);

    if (origins.length) {
      const seed = (saved) => {
        try {
          const entry = saved.find(o => o.origin === location.origin);
          if (!entry) return;
          for (const item of entry.localStorage) {
            if (item && typeof item.name === "string" && localStorage.getItem(item.name) === null) {
              localStorage.setItem(item.name, String(item.value));
            }
          }
        } catch {
          // opaque origins (about:blank, data:) have no localStorage
        }
      };
      await session.context.addInitScript(seed, origins);
      for (const page of session.context.pages()) {
        try { await page.evaluate(seed, origins); } catch { /* page closed / navigating */ }
      }
    }

    return { status: "loaded", cookies: cookies.length, origins: origins.length };
  }

  async savePdf(sessionId, params) {
    const session = await this.resolveSession(sessionId);
    const page = session.pages[session.activeTab];
    const options = { path: params.output || "page.pdf" };
    if (params.format) options.format = params.format;
    if (params.printBackground === "true" || params.printBackground === true) options.printBackground = true;
    await page.pdf(options);
    return { status: "ok", path: options.path };
  }

  async download(sessionId, params) {
    const session = await this.resolveSession(sessionId);
    const page = session.pages[session.activeTab];
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.goto(params.url).catch(() => {})
    ]);
    await download.saveAs(params.output);
    return { status: "ok", path: params.output };
  }

  async newTab(sessionId, url) {
    const session = await this.resolveSession(sessionId);
    const page = await session.context.newPage();
    if (url && url !== "") await this._navigate(page, url);
    session.pages.push(page);
    session.activeTab = session.pages.length - 1;
    return { status: "ok", tab: session.activeTab, tabs: session.pages.length };
  }

  async switchTab(sessionId, tabIndex) {
    const session = await this.resolveSession(sessionId);
    const idx = parseInt(tabIndex);
    if (idx < 0 || idx >= session.pages.length) throw new Error(`Tab index out of range: ${idx}`);
    session.activeTab = idx;
    await session.pages[idx].bringToFront();
    return { status: "ok", tab: idx, url: session.pages[idx].url() };
  }

  async closeTab(sessionId, tabIndex) {
    const session = await this.resolveSession(sessionId);
    const idx = parseInt(tabIndex);
    if (idx < 0 || idx >= session.pages.length) throw new Error(`Tab index out of range: ${idx}`);
    if (session.pages.length === 1) throw new Error("Cannot close last tab. Use close session instead.");
    await session.pages[idx].close();
    session.pages.splice(idx, 1);
    if (session.activeTab >= session.pages.length) session.activeTab = session.pages.length - 1;
    return { status: "ok", tabs: session.pages.length };
  }

  async listTabs(sessionId) {
    const session = await this.resolveSession(sessionId);
    return session.pages.map((page, index) => ({
      index, url: page.url(), active: index === session.activeTab
    }));
  }

  _listItems(base, selector) {
    const listSelector = selector || "ul, ol, [role='list'], [role='listbox']";
    const list = base.locator(listSelector).first();
    return list.locator("xpath=child::*");
  }

  async clickItem(sessionId, params) {
    const session = await this.resolveSession(sessionId);
    const base = this.getBase(session, params);
    const timeout = parseInt(params.timeout) || 5000;
    const items = this._listItems(base, params.selector);
    const item = params.item;

    if (/^\d+$/.test(item)) {
      const index = parseInt(item) - 1;
      await items.nth(index).click({ timeout });
    } else {
      await items.filter({ hasText: item }).first().click({ timeout });
    }
    return this._attachSnapshot(session, { status: "ok" });
  }

  async expectList(sessionId, params) {
    const session = await this.resolveSession(sessionId);
    const base = this.getBase(session, params);
    const timeout = parseInt(params.timeout) || 10000;
    const items = this._listItems(base, params.selector);

    switch (params.assertion) {
      case "at_least": {
        const expected = parseInt(params.expected);
        await items.nth(expected - 1).waitFor({ state: "attached", timeout });
        const count = await items.count();
        return { status: "ok", count };
      }
      case "contains": {
        await items.filter({ hasText: params.expected }).first().waitFor({ state: "visible", timeout });
        return { status: "ok" };
      }
      default:
        throw new Error(`Unknown list assertion: ${params.assertion}`);
    }
  }

  async getItems(sessionId, params) {
    const session = await this.resolveSession(sessionId);
    const base = this.getBase(session, params);
    const items = this._listItems(base, params.selector);
    const count = await items.count();
    const result = [];
    for (let i = 0; i < count; i++) {
      const text = await items.nth(i).textContent();
      result.push(text ? text.trim() : "");
    }
    return result;
  }

  async component(sessionId, params) {
    const session = await this.resolveSession(sessionId);
    const base = this.getBase(session, params);
    const timeout = parseInt(params.timeout) || 5000;
    const type = params.type;
    if (!type) throw new Error("component: --type is required");

    const { type: _t, action: _a, timeout: _to, ...componentParams } = params;
    const locator = await ComponentResolver.resolve(base, type, componentParams);
    const action = params.action || "locate";

    switch (action) {
      case "locate": {
        const count = await locator.count();
        const first = count > 0 ? await locator.first().boundingBox().catch(() => null) : null;
        return { status: "ok", type, count, bounds: first };
      }
      case "click": {
        await locator.first().click({ timeout });
        return this._attachSnapshot(session, { status: "ok" });
      }
      case "hover": {
        await locator.first().hover({ timeout });
        return this._attachSnapshot(session, { status: "ok" });
      }
      case "read": {
        // Return textual contents of the resolved locator(s).
        const count = await locator.count();
        const texts = [];
        for (let i = 0; i < count; i++) {
          const t = await locator.nth(i).textContent().catch(() => "");
          texts.push((t || "").trim().replace(/\s+/g, " "));
        }
        return { status: "ok", type, count, text: texts.length === 1 ? texts[0] : texts };
      }
      case "count": {
        // For container components with no item/row/col specified, count contents.
        let target = locator;
        if (type === "list" && !params.item) {
          target = locator.getByRole("listitem");
        } else if (type === "table" && !params.row && !params.col) {
          target = locator.getByRole("row");
        } else if (type === "nav" && !params.item) {
          target = locator.getByRole("link");
        } else if (type === "menu" && !params.item) {
          target = locator.getByRole("menuitem");
        } else if (type === "tab" && !params.tab) {
          target = locator.getByRole("tab");
        }
        const count = await target.count();
        return { status: "ok", type, count };
      }
      case "bounds": {
        const box = await locator.first().boundingBox({ timeout }).catch(() => null);
        return { status: "ok", type, bounds: box };
      }
      case "fill": {
        // For form components: fill a single field or a JSON map of fields.
        if (params.fields) {
          const fields = typeof params.fields === "string" ? JSON.parse(params.fields) : params.fields;
          for (const [name, value] of Object.entries(fields)) {
            await locator.getByLabel(name).fill(String(value), { timeout });
          }
          return this._attachSnapshot(session, { status: "ok", filled: Object.keys(fields).length });
        }
        if (params.value != null) {
          await locator.fill(String(params.value), { timeout });
          return this._attachSnapshot(session, { status: "ok" });
        }
        throw new Error("component fill: provide --fields (json) or --value");
      }
      case "scroll": {
        await locator.first().scrollIntoViewIfNeeded({ timeout });
        return this._attachSnapshot(session, { status: "ok" });
      }
      default:
        throw new Error(`Unknown component action: "${action}". Use: locate, click, hover, read, count, bounds, fill, scroll`);
    }
  }

  async snapshot(sessionId, params = {}) {
    const session = await this.resolveSession(sessionId);
    const mode = params.mode || "auto";
    const page = session.pages[session.activeTab];
    const snapshot = await SnapshotBuilder.build(page, mode);

    if (params.output) {
      const text = SnapshotBuilder.render(snapshot);
      const filePath = this._writeArtifact(
        `snapshot-${sessionId}-${Date.now()}.txt`,
        text,
        params.output
      );
      return {
        status: "ok",
        path: filePath,
        title: snapshot.title,
        url: snapshot.url,
        elementCount: snapshot.elements.length,
        componentCount: snapshot.components.length
      };
    }

    if (params.format === "text") {
      return { status: "ok", text: SnapshotBuilder.render(snapshot) };
    }
    return { status: "ok", snapshot };
  }

  // CBR-042: deterministic DOM-walk content blocks — see BlocksBuilder.js.
  // Works against an existing local OR remote (cdp/agentcore) session;
  // --url optionally navigates first, otherwise blocks the current page.
  async blocks(sessionId, params = {}) {
    const session = await this.resolveSession(sessionId);
    const page = session.pages[session.activeTab];

    if (params.url) {
      await this._navigate(page, params.url, params.waitUntil || "load");
    }

    const result = await BlocksBuilder.build(page, {
      maxBlockChars: params.maxBlockChars,
      includeNav: params.includeNav
    });

    return { status: "ok", ...result };
  }

  async execute(sessionId, instructions) {
    const completed = [];
    for (let i = 0; i < instructions.length; i++) {
      const { method, params = {} } = instructions[i];
      try {
        const result = await this.handleMethod(sessionId, method, params);
        completed.push({ index: i, method, result });
      } catch (e) {
        return {
          error: e.message, failedIndex: i,
          failedInstruction: JSON.stringify(instructions[i]),
          completedSteps: completed.length
        };
      }
    }
    return { status: "ok", completedSteps: completed.length, results: completed };
  }

  async handleMethod(sessionId, method, params) {
    switch (method) {
      case "visit": return this.visit(sessionId, params.url, params.waitUntil);
      case "back": return this.back(sessionId);
      case "forward": return this.forward(sessionId);
      case "reload": return this.reload(sessionId);
      case "click": return this.click(sessionId, params);
      case "click-selector": return this.clickSelector(sessionId, params);
      case "mouse": return this.mouse(sessionId, params);
      case "click-text": return this.clickText(sessionId, params);
      case "click-item": return this.clickItem(sessionId, params);
      case "type": return this.type(sessionId, params);
      case "scroll": return this.scroll(sessionId, params);
      case "content": return this.content(sessionId, params);
      case "screenshot": return this.screenshot(sessionId, params);
      case "save-pdf": return this.savePdf(sessionId, params);
      case "wait": return this.wait(sessionId, params);
      case "eval": return this.evaluate(sessionId, params.script);
      case "expect": return this.expect(sessionId, params);
      case "expect-list": return this.expectList(sessionId, params);
      case "get-items": return this.getItems(sessionId, params);
      case "select": return this.select(sessionId, params);
      case "check": return this.check(sessionId, params);
      case "uncheck": return this.uncheck(sessionId, params);
      case "hover": return this.hover(sessionId, params);
      case "press": return this.press(sessionId, params);
      case "clear": return this.clear(sessionId, params);
      case "upload": return this.upload(sessionId, params);
      case "set-scope": return this.setScope(sessionId, params.selector);
      case "clear-scope": return this.clearScope(sessionId);
      case "set-snapshot": return this.setSnapshot(sessionId, params.mode);
      case "read": return this.read({ ...params, session: sessionId });
      default: throw new Error(`Unknown method in execute: ${method}`);
    }
  }

  // Called when the local daemon itself stops (SIGTERM/SIGINT, or the last
  // session closing in non-persistent mode) — detach, don't close, so
  // provider-backed sessions (e.g. AgentCore) stay reattachable by whatever
  // process/daemon uses the same --session id next.
  async closeAll() {
    const ids = [...this.sessions.keys()];
    for (const id of ids) {
      try { await this.close(id, { detach: true }); } catch {}
    }
  }
}

const ENGINES = { chromium, firefox, webkit };

function normalizeBrowserName(browserName) {
  return ENGINES[browserName] ? browserName : "chromium";
}

/**
 * Returns true when Playwright's browser executable for the given engine is
 * present on disk. Never throws — a missing/uninstalled browser reports false.
 */
function isBrowserInstalled(browserName = "chromium") {
  const engine = ENGINES[normalizeBrowserName(browserName)];
  try {
    const execPath = engine.executablePath();
    return Boolean(execPath) && fs.existsSync(execPath);
  } catch {
    // Newer Playwright throws from executablePath() when the browser is absent.
    return false;
  }
}

/**
 * Locates the bundled Playwright installer CLI. playwright-core/cli.js is the
 * real installer; playwright/cli.js is a thin re-export. The package "exports"
 * map blocks direct subpath resolution, so we resolve package.json (always
 * exported) and join cli.js next to it.
 */
function resolveInstallerCli() {
  const require = createRequire(import.meta.url);
  for (const pkg of ["playwright-core", "playwright"]) {
    try {
      const pkgJson = require.resolve(`${pkg}/package.json`);
      const cli = path.join(path.dirname(pkgJson), "cli.js");
      if (fs.existsSync(cli)) return cli;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * Ensures Playwright's browser binary is present, downloading it on first use
 * (the equivalent of `npx playwright install <browser>`). Idempotent and quiet
 * when already installed; prints a one-time notice to stderr while downloading.
 *
 * Only the browser BINARY is provisioned here — OS-level shared libraries are
 * declared in the package `.aux4` "system" field (Linux) and, for containers,
 * are best baked in with `playwright install-deps chromium` at image build.
 */
function ensureBrowserInstalled(browserName = "chromium", log = defaultLog) {
  const name = normalizeBrowserName(browserName);

  if (isBrowserInstalled(name)) return { installed: false, browser: name };

  const cli = resolveInstallerCli();
  if (!cli) {
    throw new Error(
      `Playwright ${name} is not installed and the Playwright installer could not be located. ` +
        `Install it manually with: npx playwright install ${name}`
    );
  }

  log(`browser: ${name} runtime not found — installing it now (one-time, this may take a minute)...`);
  // Route the installer's download progress (fd 1) to our stderr (fd 2) so a
  // caller parsing this process's stdout (e.g. the {"status":"started"} line)
  // never sees the progress bars.
  const result = spawnSync(process.execPath, [cli, "install", name], {
    stdio: ["ignore", 2, 2],
    env: process.env
  });

  if (result.error || result.status !== 0) {
    const detail = result.error ? result.error.message : `exit code ${result.status}`;
    throw new Error(
      `Failed to install Playwright ${name} (${detail}). ` +
        `Install it manually with: npx playwright install ${name}`
    );
  }

  log(`browser: ${name} installed.`);
  return { installed: true, browser: name };
}

function defaultLog(message) {
  process.stderr.write(message + "\n");
}

class DaemonServer {
  constructor(options = {}) {
    this.maxSessions = options.maxSessions || 20;
    this.persistent = options.persistent || false;
    this.channel = options.channel || "";
    this.browserName = options.browser || "";
    this.headed = options.headed || false;
    // false = don't provision/launch the local browser at daemon start; it is
    // launched lazily on the first LOCAL session instead. Remote sessions
    // (--provider cdp / agentcore / ...) never need it, which is what lets
    // the daemon run where no local browser exists (e.g. a serverless VM
    // that only attaches to a remote browser over CDP).
    this.localBrowser = options.localBrowser !== false;
    this.localBrowserPromise = null;
    this.sessionManager = null;
    this.server = null;
    this.browser = null;
  }

  async start() {
    fs.mkdirSync(BROWSER_DIR, { recursive: true });
    if (fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH);

    // The daemon's LOCAL browser serves provider="local" sessions (the
    // default). Any provider-backed session (--provider cdp / agentcore, ...)
    // gets its own separate connection via SessionManager.open()/
    // resolveSession() — the daemon itself is never "attached" as a whole.
    // With localBrowser=false the local browser is launched lazily, only when
    // the first local session is opened.
    if (this.localBrowser) await this.ensureLocalBrowser();

    this.sessionManager = new SessionManager(() => this.ensureLocalBrowser(), {
      maxSessions: this.maxSessions,
      onEmpty: () => {
        // Deferred so the reply to the request that emptied the daemon (e.g.
        // `close`) is written before the process exits.
        if (!this.persistent) setTimeout(() => {
          if (this.sessionManager.sessions.size === 0) this.stop();
        }, 100);
      }
    });

    this.server = net.createServer((socket) => {
      let buffer = "";
      socket.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (line.trim()) this.handleLine(socket, line.trim());
        }
      });
      socket.on("error", () => {});
    });

    this.server.listen(SOCKET_PATH);
    fs.writeFileSync(PID_PATH, process.pid.toString());

    process.on("SIGTERM", () => this.stop());
    process.on("SIGINT", () => this.stop());

    console.log(JSON.stringify({ status: "started", socket: SOCKET_PATH, pid: process.pid }));
  }

  async handleLine(socket, line) {
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      socket.write(JSON.stringify({ error: { message: "Invalid JSON" } }) + "\n");
      return;
    }

    try {
      const result = await this.handleRequest(request);
      socket.write(JSON.stringify({ result, id: request.id }) + "\n");
    } catch (e) {
      let screenshot = null;
      if (request.params?.session) {
        try {
          const session = this.sessionManager.getSession(request.params.session);
          screenshot = await this.sessionManager.screenshotOnError(session);
        } catch {}
      }
      const error = { message: sanitizeMessage(this.truncateError(e.message)) };
      if (screenshot) error.screenshot = screenshot;
      socket.write(JSON.stringify({ error, id: request.id }) + "\n");
    }
  }

  ensureLocalBrowser() {
    if (!this.localBrowserPromise) {
      this.localBrowserPromise = (async () => {
        ensureBrowserInstalled(this.browserName || "chromium");
        const launchOptions = {};
        if (this.channel) launchOptions.channel = this.channel;
        if (this.browserName) launchOptions.browser = this.browserName;
        if (this.headed) launchOptions.headed = true;
        this.browser = await BrowserEngine.launch(launchOptions);
        return this.browser;
      })();
      this.localBrowserPromise.catch(() => { this.localBrowserPromise = null; });
    }
    return this.localBrowserPromise;
  }

  truncateError(message) {
    const lines = message.split("\n");
    if (lines.length <= 6) return message;
    return lines.slice(0, 3).join("\n") + `\n... and ${lines.length - 3} more lines`;
  }

  async handleRequest(request) {
    const { method, params = {} } = request;

    switch (method) {
      case "open": return this.sessionManager.open(params);
      case "close": return this.sessionManager.close(params.session);
      case "list": return this.sessionManager.list();
      case "visit": return this.sessionManager.visit(params.session, params.url, params.waitUntil);
      case "read": return this.sessionManager.read(params);
      case "back": return this.sessionManager.back(params.session);
      case "forward": return this.sessionManager.forward(params.session);
      case "reload": return this.sessionManager.reload(params.session);
      case "click": return this.sessionManager.click(params.session, params);
      case "click-selector": return this.sessionManager.clickSelector(params.session, params);
      case "mouse": return this.sessionManager.mouse(params.session, params);
      case "click-text": return this.sessionManager.clickText(params.session, params);
      case "click-item": return this.sessionManager.clickItem(params.session, params);
      case "type": return this.sessionManager.type(params.session, params);
      case "scroll": return this.sessionManager.scroll(params.session, params);
      case "content": return this.sessionManager.content(params.session, params);
      case "screenshot": return this.sessionManager.screenshot(params.session, params);
      case "wait": return this.sessionManager.wait(params.session, params);
      case "eval": return this.sessionManager.evaluate(params.session, params.script);
      case "expect": return this.sessionManager.expect(params.session, params);
      case "expect-list": return this.sessionManager.expectList(params.session, params);
      case "get-items": return this.sessionManager.getItems(params.session, params);
      case "select": return this.sessionManager.select(params.session, params);
      case "check": return this.sessionManager.check(params.session, params);
      case "uncheck": return this.sessionManager.uncheck(params.session, params);
      case "hover": return this.sessionManager.hover(params.session, params);
      case "press": return this.sessionManager.press(params.session, params);
      case "clear": return this.sessionManager.clear(params.session, params);
      case "upload": return this.sessionManager.upload(params.session, params);
      case "set-scope": return this.sessionManager.setScope(params.session, params.selector);
      case "clear-scope": return this.sessionManager.clearScope(params.session);
      case "set-snapshot": return this.sessionManager.setSnapshot(params.session, params.mode);
      case "cookies": return this.sessionManager.cookies(params.session, params);
      case "state-save": return this.sessionManager.stateSave(params.session, params);
      case "state-load": return this.sessionManager.stateLoad(params.session, params);
      case "download": return this.sessionManager.download(params.session, params);
      case "save-pdf": return this.sessionManager.savePdf(params.session, params);
      case "new-tab": return this.sessionManager.newTab(params.session, params.url);
      case "switch-tab": return this.sessionManager.switchTab(params.session, parseInt(params.tab));
      case "close-tab": return this.sessionManager.closeTab(params.session, parseInt(params.tab));
      case "list-tabs": return this.sessionManager.listTabs(params.session);
      case "execute": return this.sessionManager.execute(params.session, params.instructions);
      case "component": return this.sessionManager.component(params.session, params);
      case "snapshot": return this.sessionManager.snapshot(params.session, params);
      case "blocks": return this.sessionManager.blocks(params.session, params);
      case "stop":
        setTimeout(() => this.stop(), 100);
        return { status: "stopping" };
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  async stop() {
    // closeAll() detaches (not closes) any provider-backed sessions — it
    // only forgets them locally. We deliberately never call .close() on a
    // session's providerBrowser (the connectOverCDP handle): even though
    // Playwright documents that as "disconnect only, not terminate", we
    // avoid the CDP round-trip entirely and just let the process exit,
    // dropping the local WebSocket. That's what "detach must not end the
    // provider session" means operationally (see CBR-007/CBR-008).
    if (this.sessionManager) await this.sessionManager.closeAll();
    // this.browser is always the daemon's own LOCAL browser now (see
    // start()) — always safe/correct to close it on shutdown.
    if (this.browser) await this.browser.close();
    if (this.server) this.server.close();
    try { fs.unlinkSync(SOCKET_PATH); } catch {}
    try { fs.unlinkSync(PID_PATH); } catch {}
    if (!this.embedded) process.exit(0);
  }
}

function isDaemonRunning() {
  try {
    const pid = parseInt(fs.readFileSync(PID_PATH, "utf-8").trim());
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitForSocket(maxAttempts = 30) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const tryConnect = () => {
      attempts++;
      const socket = net.createConnection(SOCKET_PATH);
      socket.on("connect", () => { socket.end(); resolve(); });
      socket.on("error", () => {
        if (attempts >= maxAttempts) {
          reject(new Error("Daemon failed to start"));
        } else {
          setTimeout(tryConnect, 500);
        }
      });
    };
    tryConnect();
  });
}

async function StartCommand(params) {
  // If running as the forked daemon child, start server directly
  if (process.env.AUX4_BROWSER_DAEMON === "1") {
    const server = new DaemonServer({
      maxSessions: parseInt(params.maxSessions) || 20,
      persistent: params.persistent === "true" || params.persistent === true,
      channel: params.channel || "",
      browser: params.browser || "",
      headed: params.headed === "true" || params.headed === true,
      localBrowser: !(params.localBrowser === "false" || params.localBrowser === false)
    });
    await server.start();
    return;
  }

  // Already running? Just report status
  if (isDaemonRunning()) {
    console.log(JSON.stringify({ status: "already_running" }));
    return;
  }

  // Self-provision the browser binary in the foreground (before forking the
  // detached daemon) so the "installing…" notice is visible to the user and the
  // daemon child never blocks on a download while waitForSocket() is ticking.
  // Skipped with --localBrowser false (remote-only daemon: the local browser
  // is then provisioned lazily, on the first local session, if ever).
  if (!(params.localBrowser === "false" || params.localBrowser === false)) {
    ensureBrowserInstalled(params.browser || "chromium");
  }

  // Fork the daemon to the background
  const child = spawn(process.execPath, process.argv.slice(1), {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, AUX4_BROWSER_DAEMON: "1" }
  });
  child.unref();

  // Wait for the daemon socket to become available
  await waitForSocket();

  console.log(JSON.stringify({ status: "started", pid: child.pid }));
}

class DaemonClient {
  async send(method, params = {}) {
    try {
      return await this._connect(method, params);
    } catch (e) {
      if (e.code === "ENOENT" || e.code === "ECONNREFUSED" || e.message?.includes("not running")) {
        await this._autoStart(this._needsLocalBrowser(method, params));
        return await this._connect(method, params);
      }
      throw e;
    }
  }

  _connect(method, params) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(SOCKET_PATH);
      let buffer = "";
      const id = Date.now();

      socket.on("connect", () => {
        socket.write(JSON.stringify({ method, params, id }) + "\n");
      });

      socket.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const response = JSON.parse(line);
            socket.end();
            if (response.error) reject(new Error(response.error.message));
            else resolve(response.result);
          } catch {}
        }
      });

      socket.on("error", (e) => {
        reject(e);
      });
    });
  }

  // A request on a provider-backed session ("<provider>:<token>") or an
  // `open --provider <remote>` never needs the local browser, so the
  // auto-started daemon skips provisioning/launching it (it is still
  // launched lazily if a local session is opened later).
  _needsLocalBrowser(method, params = {}) {
    if (method === "open") return !params.provider || params.provider === "local";
    if (typeof params.session === "string" && params.session.includes(":")) return false;
    return true;
  }

  async _autoStart(needsLocalBrowser = true) {
    const args = ["browser", "start"];
    if (!needsLocalBrowser) args.push("--localBrowser", "false");
    const child = spawn("aux4", args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    // Wait for the socket to become available
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 500));
      try {
        await this._ping();
        return;
      } catch {}
    }
    throw new Error("Failed to auto-start browser daemon");
  }

  _ping() {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(SOCKET_PATH);
      socket.on("connect", () => { socket.end(); resolve(); });
      socket.on("error", reject);
    });
  }
}

async function StopCommand() {
  const client = new DaemonClient();
  const result = await client.send("stop");
  console.log(JSON.stringify(result));
}

async function OpenCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("open", {
    url: params.url,
    timeout: params.timeout,
    width: params.width,
    height: params.height,
    output: params.output,
    video: params.video,
    snapshot: params.snapshot,
    waitUntil: params.waitUntil,
    provider: params.provider,
    awsProfile: params.awsProfile,
    awsRegion: params.awsRegion,
    cdpUrl: params.cdpUrl
  });
  if (result.snapshot) {
    console.log(JSON.stringify(result));
  } else {
    console.log(result.sessionId);
  }
}

async function CloseCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("close", { session: params.session });
  console.log(JSON.stringify(result));
}

async function ListCommand() {
  const client = new DaemonClient();
  const result = await client.send("list");
  console.log(JSON.stringify(result));
}

async function VisitCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("visit", { session: params.session, url: params.url, waitUntil: params.waitUntil });
  console.log(JSON.stringify(result));
}

async function BackCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("back", { session: params.session });
  console.log(JSON.stringify(result));
}

async function ForwardCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("forward", { session: params.session });
  console.log(JSON.stringify(result));
}

async function ReloadCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("reload", { session: params.session });
  console.log(JSON.stringify(result));
}

async function ClickCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("click", {
    session: params.session,
    name: params.name,
    role: params.role,
    index: params.index,
    ref: params.ref,
    within: params.within
  });
  console.log(JSON.stringify(result));
}

async function ClickSelectorCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("click-selector", {
    session: params.session,
    selector: params.selector,
    within: params.within
  });
  console.log(JSON.stringify(result));
}

async function MouseCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("mouse", {
    session: params.session,
    action: params.action,
    x: params.x,
    y: params.y,
    steps: params.steps,
    selector: params.selector,
    within: params.within
  });
  console.log(JSON.stringify(result));
}

async function ClickTextCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("click-text", {
    session: params.session,
    text: params.text,
    index: params.index,
    within: params.within
  });
  console.log(JSON.stringify(result));
}

async function ClickItemCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("click-item", {
    session: params.session,
    item: params.item,
    selector: params.selector
  });
  console.log(JSON.stringify(result));
}

async function ExpectListCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("expect-list", {
    session: params.session,
    assertion: params.assertion,
    expected: params.expected,
    selector: params.selector,
    timeout: params.timeout
  });
  console.log(JSON.stringify(result));
}

async function GetItemsCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("get-items", {
    session: params.session,
    selector: params.selector
  });
  if (Array.isArray(result)) {
    result.forEach(item => console.log(item));
  }
}

async function TypeCommand(params) {
  const names = Array.isArray(params.name) ? params.name : [params.name];
  const values = Array.isArray(params.value) ? params.value : [params.value];

  if (names.length !== values.length) {
    throw new Error(`Mismatched fields: ${names.length} name(s) but ${values.length} value(s)`);
  }

  const client = new DaemonClient();

  let result;
  for (let i = 0; i < names.length; i++) {
    result = await client.send("type", {
      session: params.session,
      name: names[i],
      value: values[i],
      role: params.role,
      ref: params.ref,
      within: params.within
    });
  }
  console.log(JSON.stringify(result));
}

async function ScrollCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("scroll", {
    session: params.session,
    direction: params.direction,
    amount: params.amount,
    to: params.to
  });
  console.log(JSON.stringify(result));
}

async function ContentCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("content", {
    session: params.session,
    selector: params.selector,
    format: params.format,
    output: params.output
  });
  if (params.output) {
    console.log(JSON.stringify(result));
  } else {
    console.log(result.content);
  }
}

async function ScreenshotCommand(params) {
  const client = new DaemonClient();
  const output = params.output ? path.resolve(params.output) : path.resolve("screenshot.png");
  const result = await client.send("screenshot", {
    session: params.session,
    output,
    fullPage: params.fullPage
  });
  console.log(result.path);
}

async function WaitCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("wait", {
    session: params.session,
    selector: params.selector,
    timeout: params.timeout
  });
  console.log(JSON.stringify(result));
}

async function EvalCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("eval", {
    session: params.session,
    script: params.script
  });
  if (result.result !== undefined) {
    console.log(typeof result.result === "string" ? result.result : JSON.stringify(result.result));
  }
}

async function ExpectCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("expect", {
    session: params.session,
    selector: params.selector,
    assertion: params.assertion,
    expected: params.expected || "",
    timeout: params.timeout || "5000"
  });
  console.log(JSON.stringify(result));
}

async function CookiesCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("cookies", {
    session: params.session,
    export: params.export,
    import: params.import
  });
  console.log(JSON.stringify(result));
}

async function StateSaveCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("state-save", {
    session: params.session,
    output: params.output
  });
  console.log(JSON.stringify(result));
}

async function StateLoadCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("state-load", {
    session: params.session,
    file: params.file
  });
  console.log(JSON.stringify(result));
}

async function DownloadCommand(params) {
  const client = new DaemonClient();
  const output = params.output ? path.resolve(params.output) : undefined;
  const result = await client.send("download", {
    session: params.session,
    url: params.url,
    output
  });
  console.log(result.path);
}

async function SavePdfCommand(params) {
  const client = new DaemonClient();
  const output = params.output ? path.resolve(params.output) : path.resolve("page.pdf");
  const result = await client.send("save-pdf", {
    session: params.session,
    output,
    format: params.format,
    printBackground: params.printBackground
  });
  console.log(result.path);
}

async function NewTabCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("new-tab", {
    session: params.session,
    url: params.url
  });
  console.log(JSON.stringify(result));
}

async function SwitchTabCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("switch-tab", {
    session: params.session,
    tab: params.tab
  });
  console.log(JSON.stringify(result));
}

async function CloseTabCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("close-tab", {
    session: params.session,
    tab: params.tab
  });
  console.log(JSON.stringify(result));
}

async function ListTabsCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("list-tabs", {
    session: params.session
  });
  console.log(JSON.stringify(result));
}

async function SelectCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("select", {
    session: params.session,
    name: params.name,
    value: params.value,
    role: params.role,
    ref: params.ref
  });
  console.log(JSON.stringify(result));
}

async function CheckCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("check", {
    session: params.session,
    name: params.name,
    role: params.role,
    ref: params.ref
  });
  console.log(JSON.stringify(result));
}

async function UncheckCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("uncheck", {
    session: params.session,
    name: params.name,
    role: params.role,
    ref: params.ref
  });
  console.log(JSON.stringify(result));
}

async function HoverCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("hover", {
    session: params.session,
    name: params.name,
    role: params.role
  });
  console.log(JSON.stringify(result));
}

async function PressCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("press", {
    session: params.session,
    key: params.key,
    selector: params.selector
  });
  console.log(JSON.stringify(result));
}

async function ClearCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("clear", {
    session: params.session,
    name: params.name,
    role: params.role
  });
  console.log(JSON.stringify(result));
}

async function UploadCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("upload", {
    session: params.session,
    name: params.name,
    file: params.file
  });
  console.log(JSON.stringify(result));
}

async function SetScopeCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("set-scope", {
    session: params.session,
    selector: params.selector
  });
  console.log(JSON.stringify(result));
}

async function ClearScopeCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("clear-scope", {
    session: params.session
  });
  console.log(JSON.stringify(result));
}

async function SetSnapshotCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("set-snapshot", {
    session: params.session,
    mode: params.mode
  });
  console.log(JSON.stringify(result));
}

async function ComponentCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("component", {
    session: params.session,
    type: params.type,
    action: params.action,
    name: params.name,
    row: params.row,
    col: params.col,
    where: params.where,
    item: params.item,
    field: params.field,
    fields: params.fields,
    value: params.value,
    tab: params.tab,
    path: params.path,
    title: params.title,
    timeout: params.timeout
  });
  console.log(JSON.stringify(result));
}

async function SnapshotCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("snapshot", {
    session: params.session,
    mode: params.mode,
    format: params.format,
    output: params.output
  });
  if (params.output) {
    console.log(JSON.stringify(result));
  } else if (params.format === "text" && result.text != null) {
    console.log(result.text);
  } else {
    console.log(JSON.stringify(result));
  }
}

async function ReadCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("read", {
    url: params.url,
    session: params.session,
    format: params.format,
    waitUntil: params.waitUntil,
    output: params.output
  });
  console.log(JSON.stringify(result));
}

async function BlocksCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("blocks", {
    session: params.session,
    url: params.url,
    waitUntil: params.waitUntil,
    maxBlockChars: params.maxBlockChars,
    includeNav: params.includeNav
  });
  console.log(JSON.stringify(result.blocks || []));
}

const args = process.argv.slice(2);
const action = args[0];
const values = args.slice(1);

const commands = {
  start:       { handler: StartCommand,    args: ["maxSessions", "persistent", "channel", "browser", "headed", "localBrowser"] },
  stop:        { handler: StopCommand,     args: [] },
  open:        { handler: OpenCommand,     args: ["url", "timeout", "width", "height", "output", "video", "snapshot", "waitUntil", "provider", "awsProfile", "awsRegion", "cdpUrl"] },
  close:       { handler: CloseCommand,    args: ["session"] },
  list:        { handler: ListCommand,     args: [] },
  visit:       { handler: VisitCommand,    args: ["session", "url", "waitUntil"] },
  back:        { handler: BackCommand,     args: ["session"] },
  forward:     { handler: ForwardCommand,  args: ["session"] },
  reload:      { handler: ReloadCommand,   args: ["session"] },
  click:       { handler: ClickCommand,    args: ["session", "name", "role", "index", "ref", "within"] },
  "click-selector": { handler: ClickSelectorCommand, args: ["session", "selector", "within"] },
  mouse:       { handler: MouseCommand,    args: ["session", "action", "x", "y", "steps", "selector", "within"] },
  "click-text": { handler: ClickTextCommand, args: ["session", "text", "index", "within"] },
  "click-item": { handler: ClickItemCommand, args: ["session", "item", "selector"] },
  type:        { handler: TypeCommand,     args: ["session", "name", "value", "role", "ref", "within"] },
  scroll:      { handler: ScrollCommand,   args: ["session", "direction", "amount", "to"] },
  content:     { handler: ContentCommand,  args: ["session", "selector", "format", "output"] },
  screenshot:  { handler: ScreenshotCommand, args: ["session", "output", "fullPage"] },
  read:        { handler: ReadCommand,     args: ["url", "session", "format", "waitUntil", "output"] },
  wait:        { handler: WaitCommand,     args: ["session", "selector", "timeout"] },
  eval:        { handler: EvalCommand,     args: ["session", "script"] },
  expect:      { handler: ExpectCommand,  args: ["session", "selector", "assertion", "expected", "timeout"] },
  "expect-list": { handler: ExpectListCommand, args: ["session", "assertion", "expected", "selector", "timeout"] },
  "get-items": { handler: GetItemsCommand, args: ["session", "selector"] },
  cookies:     { handler: CookiesCommand,  args: ["session", "export", "import"] },
  "state-save": { handler: StateSaveCommand, args: ["session", "output"] },
  "state-load": { handler: StateLoadCommand, args: ["session", "file"] },
  download:    { handler: DownloadCommand, args: ["session", "url", "output"] },
  "save-pdf":  { handler: SavePdfCommand,  args: ["session", "output", "format", "printBackground"] },
  select:      { handler: SelectCommand,   args: ["session", "name", "value", "role", "ref"] },
  check:       { handler: CheckCommand,    args: ["session", "name", "role", "ref"] },
  uncheck:     { handler: UncheckCommand,  args: ["session", "name", "role", "ref"] },
  hover:       { handler: HoverCommand,    args: ["session", "name", "role"] },
  press:       { handler: PressCommand,    args: ["session", "key", "selector"] },
  clear:       { handler: ClearCommand,    args: ["session", "name", "role"] },
  upload:      { handler: UploadCommand,   args: ["session", "name", "file"] },
  "set-scope": { handler: SetScopeCommand, args: ["session", "selector"] },
  "clear-scope": { handler: ClearScopeCommand, args: ["session"] },
  "set-snapshot": { handler: SetSnapshotCommand, args: ["session", "mode"] },
  component:   { handler: ComponentCommand, args: ["session", "type", "action", "name", "row", "col", "where", "item", "field", "fields", "value", "tab", "path", "title", "timeout"] },
  snapshot:    { handler: SnapshotCommand, args: ["session", "mode", "format", "output"] },
  blocks:      { handler: BlocksCommand,   args: ["session", "url", "waitUntil", "maxBlockChars", "includeNav"] },
  "new-tab":   { handler: NewTabCommand,   args: ["session", "url"] },
  "switch-tab": { handler: SwitchTabCommand, args: ["session", "tab"] },
  "close-tab": { handler: CloseTabCommand, args: ["session", "tab"] },
  "list-tabs": { handler: ListTabsCommand, args: ["session"] },
};

const command = commands[action];
if (!command) {
  console.error(`Unknown action: ${action}`);
  process.exit(1);
}

const params = {};
command.args.forEach((name, i) => {
  if (values[i] !== undefined && values[i] !== "") {
    try {
      const parsed = JSON.parse(values[i]);
      if (Array.isArray(parsed)) {
        params[name] = parsed;
      } else {
        params[name] = values[i];
      }
    } catch {
      params[name] = values[i];
    }
  }
});

try {
  await command.handler(params);
} catch (e) {
  console.error(JSON.stringify({ error: e.message }));
  process.exit(1);
}
