import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { webkit, firefox, chromium } from 'playwright';

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
      case "text":
        content = (await element.textContent()).trim();
        break;
      case "markdown":
      default:
        const html = await element.innerHTML();
        content = ContentExtractor.htmlToMarkdown(html);
        break;
    }

    const result = { content };
    const warning = ContentExtractor.checkContent(page, content);
    if (warning) result.warning = warning;
    return result;
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

  static htmlToMarkdown(html) {
    return html
      .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n\n")
      .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n\n")
      .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n\n")
      .replace(/<h4[^>]*>(.*?)<\/h4>/gi, "#### $1\n\n")
      .replace(/<h5[^>]*>(.*?)<\/h5>/gi, "##### $1\n\n")
      .replace(/<h6[^>]*>(.*?)<\/h6>/gi, "###### $1\n\n")
      .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)")
      .replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**")
      .replace(/<b[^>]*>(.*?)<\/b>/gi, "**$1**")
      .replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*")
      .replace(/<i[^>]*>(.*?)<\/i>/gi, "*$1*")
      .replace(/<code[^>]*>(.*?)<\/code>/gi, "`$1`")
      .replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n\n")
      .replace(/<img[^>]*>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
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

      const all = Array.from(document.querySelectorAll("*"));
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

    return data;
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

const ARTIFACTS_DIR = path.join(os.homedir(), ".aux4.config", "browser", "artifacts");

class SessionManager {
  constructor(browser, options = {}) {
    this.browser = browser;
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

  setScope(sessionId, selector) {
    const session = this.getSession(sessionId);
    if (!session.scopeStack) session.scopeStack = [];
    if (session.scope) session.scopeStack.push(session.scope);
    session.scope = selector;
    return { status: "ok", scope: selector };
  }

  setSnapshot(sessionId, mode) {
    const session = this.getSession(sessionId);
    session.snapshotMode = mode || "off";
    return { status: "ok", snapshot: session.snapshotMode };
  }

  clearScope(sessionId) {
    const session = this.getSession(sessionId);
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
    if (strategy === "settle") {
      const response = await page.goto(url, { waitUntil: "domcontentloaded" });
      await this._waitForSettle(page);
      return response;
    }
    return page.goto(url, { waitUntil: strategy });
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

    const id = crypto.randomUUID().slice(0, 8);
    const timeout = this.parseTimeout(params.timeout || "10m");
    const outputDir = params.output || "";
    const videoMode = params.video || "off";

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
    const context = await this.browser.newContext(contextOptions);

    const page = await context.newPage();
    let response = null;
    if (params.url && params.url !== "") {
      response = await this._navigate(page, params.url, params.waitUntil);
    }

    const snapshotMode = params.snapshot || "off";
    const session = {
      id, context, pages: [page], activeTab: 0,
      timeout, createdAt: Date.now(), lastActivity: Date.now(),
      timer: setTimeout(() => this.close(id), timeout),
      outputDir, videoMode, hadError: false, snapshotMode
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

  async close(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    clearTimeout(session.timer);

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

  list() {
    const result = [];
    for (const [id, session] of this.sessions) {
      const activePage = session.pages[session.activeTab];
      result.push({
        id, url: activePage ? activePage.url() : "",
        tabs: session.pages.length, createdAt: session.createdAt
      });
    }
    return result;
  }

  async visit(sessionId, url, waitUntil) {
    const session = this.getSession(sessionId);
    const page = session.pages[session.activeTab];
    const response = await this._navigate(page, url, waitUntil);
    const info = await this._pageInfoAsync(page, response);
    return this._attachSnapshot(session, { status: "ok", ...info });
  }

  async back(sessionId) {
    const session = this.getSession(sessionId);
    const page = session.pages[session.activeTab];
    await page.goBack();
    return this._attachSnapshot(session, { status: "ok", url: page.url() });
  }

  async forward(sessionId) {
    const session = this.getSession(sessionId);
    const page = session.pages[session.activeTab];
    await page.goForward();
    return this._attachSnapshot(session, { status: "ok", url: page.url() });
  }

  async reload(sessionId) {
    const session = this.getSession(sessionId);
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

  async click(sessionId, params) {
    const session = this.getSession(sessionId);
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
        for (const el of document.querySelectorAll("*")) {
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
    const session = this.getSession(sessionId);
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
    const session = this.getSession(sessionId);
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
    const session = this.getSession(sessionId);
    const base = this.getBase(session, params);
    const locator = base.getByText(params.text, { exact: false });
    const index = params.index != null ? parseInt(params.index) - 1 : 0;
    const timeout = parseInt(params.timeout) || 5000;
    return this._clickWithTimeout(session, locator.nth(index), timeout, `text="${params.text}"`);
  }

  async type(sessionId, params) {
    const session = this.getSession(sessionId);
    const base = this.getBase(session, params);
    const role = params.role || "textbox";
    await base.getByRole(role, { name: params.name }).fill(params.value);
    return this._attachSnapshot(session, { status: "ok" });
  }

  async scroll(sessionId, params) {
    const session = this.getSession(sessionId);
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
    const session = this.getSession(sessionId);
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

    const session = this.getSession(sessionId);
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
    const session = this.getSession(sessionId);
    const page = session.pages[session.activeTab];
    const options = { path: params.output || "screenshot.png" };
    if (params.fullPage === "true" || params.fullPage === true) options.fullPage = true;
    await page.screenshot(options);
    return { status: "ok", path: options.path };
  }

  async wait(sessionId, params) {
    const session = this.getSession(sessionId);
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
    const session = this.getSession(sessionId);
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
    const session = this.getSession(sessionId);
    const base = this.getBase(session, params);
    const role = params.role || "combobox";
    await base.getByRole(role, { name: params.name }).selectOption(params.value, { timeout: parseInt(params.timeout) || 5000 });
    return this._attachSnapshot(session, { status: "ok" });
  }

  async check(sessionId, params) {
    const session = this.getSession(sessionId);
    const base = this.getBase(session, params);
    const role = params.role || "checkbox";
    await base.getByRole(role, { name: params.name }).check({ timeout: parseInt(params.timeout) || 5000 });
    return this._attachSnapshot(session, { status: "ok" });
  }

  async uncheck(sessionId, params) {
    const session = this.getSession(sessionId);
    const base = this.getBase(session, params);
    const role = params.role || "checkbox";
    await base.getByRole(role, { name: params.name }).uncheck({ timeout: parseInt(params.timeout) || 5000 });
    return this._attachSnapshot(session, { status: "ok" });
  }

  async hover(sessionId, params) {
    const session = this.getSession(sessionId);
    const base = this.getBase(session, params);
    const role = params.role || "button";
    await base.getByRole(role, { name: params.name }).hover({ timeout: parseInt(params.timeout) || 5000 });
    return this._attachSnapshot(session, { status: "ok" });
  }

  async press(sessionId, params) {
    const session = this.getSession(sessionId);
    const page = session.pages[session.activeTab];
    if (params.selector) {
      const base = this.getBase(session, params);
      await base.locator(params.selector).first().focus({ timeout: parseInt(params.timeout) || 5000 });
    }
    await page.keyboard.press(params.key);
    return this._attachSnapshot(session, { status: "ok" });
  }

  async clear(sessionId, params) {
    const session = this.getSession(sessionId);
    const base = this.getBase(session, params);
    const role = params.role || "textbox";
    await base.getByRole(role, { name: params.name }).clear({ timeout: parseInt(params.timeout) || 5000 });
    return { status: "ok" };
  }

  async upload(sessionId, params) {
    const session = this.getSession(sessionId);
    const base = this.getBase(session, params);
    await base.getByLabel(params.name).setInputFiles(params.file, { timeout: parseInt(params.timeout) || 5000 });
    return { status: "ok" };
  }

  async evaluate(sessionId, script) {
    const session = this.getSession(sessionId);
    const page = session.pages[session.activeTab];
    const result = await page.evaluate(script);
    return { result };
  }

  async cookies(sessionId, params) {
    const session = this.getSession(sessionId);
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

  async savePdf(sessionId, params) {
    const session = this.getSession(sessionId);
    const page = session.pages[session.activeTab];
    const options = { path: params.output || "page.pdf" };
    if (params.format) options.format = params.format;
    if (params.printBackground === "true" || params.printBackground === true) options.printBackground = true;
    await page.pdf(options);
    return { status: "ok", path: options.path };
  }

  async download(sessionId, params) {
    const session = this.getSession(sessionId);
    const page = session.pages[session.activeTab];
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.goto(params.url).catch(() => {})
    ]);
    await download.saveAs(params.output);
    return { status: "ok", path: params.output };
  }

  async newTab(sessionId, url) {
    const session = this.getSession(sessionId);
    const page = await session.context.newPage();
    if (url && url !== "") await this._navigate(page, url);
    session.pages.push(page);
    session.activeTab = session.pages.length - 1;
    return { status: "ok", tab: session.activeTab, tabs: session.pages.length };
  }

  async switchTab(sessionId, tabIndex) {
    const session = this.getSession(sessionId);
    const idx = parseInt(tabIndex);
    if (idx < 0 || idx >= session.pages.length) throw new Error(`Tab index out of range: ${idx}`);
    session.activeTab = idx;
    await session.pages[idx].bringToFront();
    return { status: "ok", tab: idx, url: session.pages[idx].url() };
  }

  async closeTab(sessionId, tabIndex) {
    const session = this.getSession(sessionId);
    const idx = parseInt(tabIndex);
    if (idx < 0 || idx >= session.pages.length) throw new Error(`Tab index out of range: ${idx}`);
    if (session.pages.length === 1) throw new Error("Cannot close last tab. Use close session instead.");
    await session.pages[idx].close();
    session.pages.splice(idx, 1);
    if (session.activeTab >= session.pages.length) session.activeTab = session.pages.length - 1;
    return { status: "ok", tabs: session.pages.length };
  }

  listTabs(sessionId) {
    const session = this.getSession(sessionId);
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
    const session = this.getSession(sessionId);
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
    const session = this.getSession(sessionId);
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
    const session = this.getSession(sessionId);
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
    const session = this.getSession(sessionId);
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
    const session = this.getSession(sessionId);
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

  async closeAll() {
    const ids = [...this.sessions.keys()];
    for (const id of ids) {
      try { await this.close(id); } catch {}
    }
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
}

const SOCKET_DIR$1 = path.join(os.homedir(), ".aux4.config", "browser");
const SOCKET_PATH$2 = path.join(SOCKET_DIR$1, "browser.sock");
const PID_PATH$1 = path.join(SOCKET_DIR$1, "browser.pid");

class DaemonServer {
  constructor(options = {}) {
    this.maxSessions = options.maxSessions || 20;
    this.persistent = options.persistent || false;
    this.channel = options.channel || "";
    this.browserName = options.browser || "";
    this.headed = options.headed || false;
    this.sessionManager = null;
    this.server = null;
    this.browser = null;
  }

  async start() {
    fs.mkdirSync(SOCKET_DIR$1, { recursive: true });
    if (fs.existsSync(SOCKET_PATH$2)) fs.unlinkSync(SOCKET_PATH$2);

    const launchOptions = {};
    if (this.channel) launchOptions.channel = this.channel;
    if (this.browserName) launchOptions.browser = this.browserName;
    if (this.headed) launchOptions.headed = true;
    this.browser = await BrowserEngine.launch(launchOptions);
    this.sessionManager = new SessionManager(this.browser, {
      maxSessions: this.maxSessions,
      onEmpty: () => {
        if (!this.persistent) this.stop();
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

    this.server.listen(SOCKET_PATH$2);
    fs.writeFileSync(PID_PATH$1, process.pid.toString());

    process.on("SIGTERM", () => this.stop());
    process.on("SIGINT", () => this.stop());

    console.log(JSON.stringify({ status: "started", socket: SOCKET_PATH$2, pid: process.pid }));
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
      const error = { message: this.truncateError(e.message) };
      if (screenshot) error.screenshot = screenshot;
      socket.write(JSON.stringify({ error, id: request.id }) + "\n");
    }
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
      case "download": return this.sessionManager.download(params.session, params);
      case "save-pdf": return this.sessionManager.savePdf(params.session, params);
      case "new-tab": return this.sessionManager.newTab(params.session, params.url);
      case "switch-tab": return this.sessionManager.switchTab(params.session, parseInt(params.tab));
      case "close-tab": return this.sessionManager.closeTab(params.session, parseInt(params.tab));
      case "list-tabs": return this.sessionManager.listTabs(params.session);
      case "execute": return this.sessionManager.execute(params.session, params.instructions);
      case "component": return this.sessionManager.component(params.session, params);
      case "snapshot": return this.sessionManager.snapshot(params.session, params);
      case "stop":
        setTimeout(() => this.stop(), 100);
        return { status: "stopping" };
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  async stop() {
    if (this.sessionManager) await this.sessionManager.closeAll();
    if (this.browser) await this.browser.close();
    if (this.server) this.server.close();
    try { fs.unlinkSync(SOCKET_PATH$2); } catch {}
    try { fs.unlinkSync(PID_PATH$1); } catch {}
    if (!this.embedded) process.exit(0);
  }
}

const SOCKET_DIR = path.join(os.homedir(), ".aux4.config", "browser");
const SOCKET_PATH$1 = path.join(SOCKET_DIR, "browser.sock");
const PID_PATH = path.join(SOCKET_DIR, "browser.pid");

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
      const socket = net.createConnection(SOCKET_PATH$1);
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
      headed: params.headed === "true" || params.headed === true
    });
    await server.start();
    return;
  }

  // Already running? Just report status
  if (isDaemonRunning()) {
    console.log(JSON.stringify({ status: "already_running" }));
    return;
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

const SOCKET_PATH = path.join(os.homedir(), ".aux4.config", "browser", "browser.sock");

class DaemonClient {
  async send(method, params = {}) {
    try {
      return await this._connect(method, params);
    } catch (e) {
      if (e.code === "ENOENT" || e.code === "ECONNREFUSED" || e.message?.includes("not running")) {
        await this._autoStart();
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

  async _autoStart() {
    const child = spawn("aux4", ["browser", "start"], {
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
    waitUntil: params.waitUntil
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
    role: params.role
  });
  console.log(JSON.stringify(result));
}

async function CheckCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("check", {
    session: params.session,
    name: params.name,
    role: params.role
  });
  console.log(JSON.stringify(result));
}

async function UncheckCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("uncheck", {
    session: params.session,
    name: params.name,
    role: params.role
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

const args = process.argv.slice(2);
const action = args[0];
const values = args.slice(1);

const commands = {
  start:       { handler: StartCommand,    args: ["maxSessions", "persistent", "channel", "browser", "headed"] },
  stop:        { handler: StopCommand,     args: [] },
  open:        { handler: OpenCommand,     args: ["url", "timeout", "width", "height", "output", "video", "snapshot", "waitUntil"] },
  close:       { handler: CloseCommand,    args: ["session"] },
  list:        { handler: ListCommand,     args: [] },
  visit:       { handler: VisitCommand,    args: ["session", "url", "waitUntil"] },
  back:        { handler: BackCommand,     args: ["session"] },
  forward:     { handler: ForwardCommand,  args: ["session"] },
  reload:      { handler: ReloadCommand,   args: ["session"] },
  click:       { handler: ClickCommand,    args: ["session", "name", "role", "index", "ref", "within"] },
  "click-selector": { handler: ClickSelectorCommand, args: ["session", "selector", "within"] },
  mouse:       { handler: MouseCommand, args: ["session", "action", "x", "y", "steps", "selector", "within"] },
  "click-text": { handler: ClickTextCommand, args: ["session", "text", "index", "within"] },
  "click-item": { handler: ClickItemCommand, args: ["session", "item", "selector"] },
  type:        { handler: TypeCommand,     args: ["session", "name", "value", "role", "within"] },
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
  download:    { handler: DownloadCommand, args: ["session", "url", "output"] },
  "save-pdf":  { handler: SavePdfCommand,  args: ["session", "output", "format", "printBackground"] },
  select:      { handler: SelectCommand,   args: ["session", "name", "value", "role"] },
  check:       { handler: CheckCommand,    args: ["session", "name", "role"] },
  uncheck:     { handler: UncheckCommand,  args: ["session", "name", "role"] },
  hover:       { handler: HoverCommand,    args: ["session", "name", "role"] },
  press:       { handler: PressCommand,    args: ["session", "key", "selector"] },
  clear:       { handler: ClearCommand,    args: ["session", "name", "role"] },
  upload:      { handler: UploadCommand,   args: ["session", "name", "file"] },
  "set-scope": { handler: SetScopeCommand, args: ["session", "selector"] },
  "clear-scope": { handler: ClearScopeCommand, args: ["session"] },
  "set-snapshot": { handler: SetSnapshotCommand, args: ["session", "mode"] },
  component:   { handler: ComponentCommand, args: ["session", "type", "action", "name", "row", "col", "where", "item", "field", "fields", "value", "tab", "path", "title", "timeout"] },
  snapshot:    { handler: SnapshotCommand, args: ["session", "mode", "format", "output"] },
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
