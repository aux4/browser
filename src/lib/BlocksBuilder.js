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

const INTERACTIVE_ROLES = [
  "button", "link", "textbox", "checkbox", "radio", "combobox", "listbox",
  "menuitem", "tab", "switch", "searchbox", "slider", "spinbutton", "option"
];

const COMPONENT_ROLES = ["table", "form", "list", "navigation", "menu", "dialog", "tablist", "tree"];

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

export class BlocksBuilder {
  static async build(page, options = {}) {
    const maxBlockChars = parseInt(options.maxBlockChars) || 1500;
    const includeNav = options.includeNav === true || options.includeNav === "true";

    const args = {
        interactiveRoles: INTERACTIVE_ROLES,
        componentRoles: COMPONENT_ROLES,
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
export async function visibleChildFrames(page) {
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
