import { spawnSync, spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import require$$0$3 from 'events';
import require$$1$1 from 'https';
import require$$2$1 from 'http';
import require$$3 from 'net';
import require$$4 from 'tls';
import require$$1 from 'crypto';
import require$$0$2 from 'stream';
import require$$7 from 'url';
import require$$0 from 'zlib';
import require$$0$1 from 'buffer';
import require$$2 from 'util';

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
        const tag = el.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") {
          if (el.id) {
            const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
            if (label) return (label.textContent || "").trim().slice(0, 120);
          }
          const parentLabel = el.closest("label");
          if (parentLabel) return (parentLabel.textContent || "").trim().slice(0, 120);
          const placeholder = el.getAttribute("placeholder");
          if (placeholder) return placeholder.trim();
          const controlTitle = el.getAttribute("title");
          if (controlTitle) return controlTitle.trim();
          // A form control's textContent is not its accessible name -- for <select> it is the
          // concatenated option text, which no locator can match. Report nothing rather than a
          // name that looks usable and is not.
          return "";
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

// Which command drives which role -- used to point a failed target at the right one.
const COMMAND_FOR_ROLE = {
  textbox: "type",
  searchbox: "type",
  spinbutton: "type",
  combobox: "select",
  listbox: "select",
  checkbox: "check",
  radio: "check",
  switch: "check",
  button: "click",
  link: "click",
  menuitem: "click",
  tab: "click",
  option: "click"
};

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

    // `open` always creates a NEW context, so a second open on a host you already have a session
    // for silently discards its cookies -- you are signed out without being told. That reads as
    // navigation and is almost always meant as `visit`. Refuse and say so, naming the session to
    // navigate. Only same-host collides; a genuinely different site is normal multi-session use.
    if (params.url && !params.new) {
      const host = (() => { try { return new URL(params.url).host; } catch { return null; } })();
      if (host) {
        for (const [id, session] of this.sessions) {
          const current = session.pages[session.activeTab].url();
          const openHost = (() => { try { return new URL(current).host; } catch { return null; } })();
          if (openHost === host) {
            return {
              status: "error",
              reason: "session-already-open",
              session: id,
              currentUrl: current,
              hint: `Session ${id} is already open on ${host} (currently ${current}). `
                + `Opening again would create a new session and lose its cookies -- you would be signed out. `
                + `To go to another page in it: aux4 browser visit --session ${id} --url ${params.url}. `
                + `If you really need a separate session, pass --new.`
            };
          }
        }
      }
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

  // A click that matched nothing is where the page state is most needed, so the failure
  // carries the elements that *are* clickable -- each with the ref that would have worked.
  // Without them the caller only learns what did not match, which is a dead end.
  async _candidates(session, role, limit = 20) {
    try {
      const page = session.pages[session.activeTab];
      const snapshot = await SnapshotBuilder.build(page, "auto");
      if (!snapshot || !snapshot.elements) return [];
      return snapshot.elements
        .filter(e => !role || e.role === role)
        .map(e => ({ ref: e.ref, role: e.role, name: e.name }))
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  // A name can be present while the role is wrong -- "Role" is a combobox, not a textbox, so
  // `type` waits for something that will never appear. Saying which role the name actually has,
  // and which command handles that role, turns a dead end into a next step.
  async _targetFailure(session, requestedRole, name) {
    const page = session.pages[session.activeTab];
    const all = await this._candidates(session, null, 200);
    const wanted = String(name == null ? "" : name).trim().toLowerCase();
    const sameName = wanted ? all.filter(e => (e.name || "").trim().toLowerCase() === wanted) : [];
    const sameRole = all.filter(e => e.role === requestedRole).slice(0, 20);

    const result = {
      status: "error",
      reason: "no-match",
      description: `role=${requestedRole} name="${name}"`,
      currentUrl: page.url(),
      candidates: sameRole
    };

    const mismatched = sameName.find(e => e.role !== requestedRole);
    if (mismatched) {
      result.matched = sameName;
      const command = COMMAND_FOR_ROLE[mismatched.role];
      result.hint = `"${name}" is a ${mismatched.role}, not a ${requestedRole}.`
        + (command ? ` Use 'aux4 browser ${command}'` : " Use a command for that role")
        + ` (or --ref ${mismatched.ref}).`;
    } else if (sameRole.length) {
      result.hint = `No ${requestedRole} named "${name}". Retry with --ref <n> from candidates above.`;
    } else {
      result.hint = `No ${requestedRole} found on the page.`;
    }
    return result;
  }

  // A click can navigate, and `{status:"ok"}` alone leaves the caller with no idea where it
  // landed -- which makes it guess URLs instead of reading the page it is already on. Report the
  // resulting page and its elements, whatever the session's snapshot mode.
  async _afterAction(session) {
    const page = session.pages[session.activeTab];
    // A click that submits a form navigates, and Playwright only waits for the click itself.
    // Without this the URL has already changed while the new document has not rendered, so the
    // snapshot reports a page with no elements -- worse than no snapshot, because it reads as
    // "this page is empty" rather than "ask again".
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    } catch {
      // best effort: a page that never fires the event still reports whatever is there now
    }
    const info = await this._pageInfoAsync(page, null);
    return this._attachSnapshot(session, { status: "ok", ...info }, "auto");
  }

  // Run a locator action, converting a "nothing matched" timeout into an actionable report.
  async _withTargetFailure(session, role, name, action) {
    // Without a target, getByRole(role, {name: undefined}) matches the FIRST element of that
    // role and reports success -- so a caller that passed an unsupported flag gets "ok" for an
    // element it never asked for. Refuse instead: a wrong success is worse than an error.
    if ((name == null || String(name).trim() === "")) {
      return {
        status: "error",
        reason: "no-target",
        description: `role=${role} with no --name and no --ref`,
        currentUrl: session.pages[session.activeTab].url(),
        candidates: await this._candidates(session, role),
        hint: `Name the element to act on: --name "<accessible name>" or --ref <n> from 'aux4 browser snapshot'.`
      };
    }
    try {
      await action();
      return this._attachSnapshot(session, { status: "ok" });
    } catch (e) {
      if (e.message && e.message.includes("Timeout")) {
        return this._targetFailure(session, role, name);
      }
      throw e;
    }
  }

  // Resolve a snapshot ref to a locator. The ref is an index into the same element walk
  // SnapshotBuilder uses, so it is resolved by re-walking the page and tagging the match --
  // giving every command (not just click) the ref targeting the snapshot advertises.
  async _locatorForRef(session, refValue) {
    const page = session.pages[session.activeTab];
    const ref = parseInt(refValue);
    const marker = `aux4ref${ref}`;

    const found = await page.evaluate(({ targetRef, attr }) => {
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

      for (const stale of document.querySelectorAll(`[${attr}]`)) stale.removeAttribute(attr);

      let ref = 0;
      for (const el of document.querySelectorAll("*")) {
        const role = el.getAttribute("role") || implicitRole(el);
        if (!role || !allRoles.includes(role)) continue;
        if (!isVisible(el)) continue;
        ref++;
        if (ref === targetRef) {
          el.setAttribute(attr, "");
          return true;
        }
      }
      return false;
    }, { targetRef: ref, attr: marker });

    if (!found) {
      // A ref indexes ONE snapshot. The common cause of a miss is acting on a ref taken before
      // navigating -- the page changed underneath it. "not found" reads as "that element is
      // gone"; say the page moved and show what is here now, with the refs that are valid.
      const here = await this._candidates(session, null);
      const err = new Error(
        `Snapshot ref [${ref}] is not on this page. Refs come from one snapshot, and this page `
        + `(${page.url()}) has ${here.length} element(s) -- the page changed since that snapshot. `
        + `Take a fresh snapshot, then use a ref from it. Currently here: `
        + (here.length ? here.map(e => `[${e.ref}] ${e.role} "${e.name}"`).join(", ") : "nothing interactive")
      );
      err.staleRef = true;
      throw err;
    }
    return page.locator(`[${marker}]`);
  }

  async _clickWithTimeout(session, locator, timeout, description, role) {
    try {
      await locator.click({ timeout });
      return this._afterAction(session);
    } catch (e) {
      if (e.message && e.message.includes("Timeout")) {
        const page = session.pages[session.activeTab];
        let candidates = await this._candidates(session, role);
        // Nothing of that role -- show every clickable element rather than an empty list.
        if (candidates.length === 0) candidates = await this._candidates(session, null);
        return {
          clicked: false,
          reason: "no-match",
          description,
          timeout,
          currentUrl: page.url(),
          title: await page.title().catch(() => ""),
          candidates,
          hint: candidates.length
            ? "Nothing matched. Retry with --ref <n> from candidates above."
            : "Nothing matched and no elements found -- check the page loaded."
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
      const locator = await this._locatorForRef(session, params.ref);
      await locator.click({ timeout });
      return this._afterAction(session);
    }

    const base = this.getBase(session, params);
    const role = params.role || "button";
    const locator = base.getByRole(role, { name: params.name });
    const index = params.index != null ? parseInt(params.index) - 1 : 0;
    return this._clickWithTimeout(session, locator.nth(index), timeout, `role=${role} name="${params.name}"`, role);
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
    if (params.ref != null) {
      const locator = await this._locatorForRef(session, params.ref);
      await locator.fill(params.value);
      return this._attachSnapshot(session, { status: "ok" });
    }
    const base = this.getBase(session, params);
    const role = params.role || "textbox";
    const timeout = parseInt(params.timeout) || 5000;
    return this._withTargetFailure(session, role, params.name, () =>
      base.getByRole(role, { name: params.name }).fill(params.value, { timeout })
    );
  }

  // Fill a whole form in one call. The caller names fields and values; which action each field
  // needs -- fill, selectOption, check -- is read from the page rather than decided by the
  // caller. Getting `type` vs `select` wrong is the single most common way a form fill fails,
  // and this removes the choice instead of reporting it better.
  async fill(sessionId, params) {
    const session = this.getSession(sessionId);
    const timeout = parseInt(params.timeout) || 5000;
    const specs = params.field == null ? [] : (Array.isArray(params.field) ? params.field : [params.field]);
    const all = await this._candidates(session, null, 200);
    const results = [];

    for (const spec of specs.filter(s => s !== "" && s != null)) {
      const raw = String(spec);
      const at = raw.indexOf("=");
      const name = (at === -1 ? raw : raw.slice(0, at)).trim();
      const value = at === -1 ? "" : raw.slice(at + 1);

      const element = all.find(e => (e.name || "").trim().toLowerCase() === name.toLowerCase());
      if (!element) {
        results.push({
          field: name,
          status: "error",
          reason: "not-found",
          candidates: all.filter(e => COMMAND_FOR_ROLE[e.role]).slice(0, 20)
        });
        continue;
      }

      try {
        const locator = await this._locatorForRef(session, element.ref);
        const role = element.role;

        if (role === "combobox" || role === "listbox") {
          // A caller may name the option by its value ("br") or its visible label ("Brazil").
          try {
            await locator.selectOption(value, { timeout });
          } catch {
            await locator.selectOption({ label: value }, { timeout });
          }
        } else if (role === "checkbox" || role === "radio" || role === "switch") {
          const off = ["no", "false", "off", "0", "unchecked", "uncheck"].includes(value.trim().toLowerCase());
          if (off) {
            await locator.uncheck({ timeout });
          } else {
            await locator.check({ timeout });
          }
        } else if (COMMAND_FOR_ROLE[role] === "type") {
          await locator.fill(value, { timeout });
        } else {
          results.push({ field: name, status: "error", reason: "not-fillable", role });
          continue;
        }

        results.push({ field: name, status: "ok", role, ref: element.ref });
      } catch (e) {
        results.push({ field: name, status: "error", reason: e.message.split("\n")[0], role: element.role });
      }
    }

    // A field that cannot be filled never stops the ones that can: every field is attempted,
    // and the failures come back named so the caller can take another route for those alone.
    const failed = results.filter(r => r.status !== "ok");
    const result = {
      status: failed.length ? "partial" : "ok",
      url: session.pages[session.activeTab].url(),
      filled: results.length - failed.length,
      fields: results
    };
    // A filled form that is never submitted is a silent no-op: the values sit in the DOM, the
    // caller reads "ok", and nothing was saved. Name the submit control so the next step is
    // obvious rather than assumed.
    if (!failed.length && results.length) {
      const buttons = (await this._candidates(session, "button")).filter(b => b.name);
      if (buttons.length) {
        const submit = buttons.find(b => /save|submit|sign|continue|next|create|send/i.test(b.name)) || buttons[0];
        result.submitWith = `aux4 browser click --session <id> --ref ${submit.ref}`;
        result.hint = `Filled ${results.length} field(s). Nothing is saved until the form is submitted: `
          + `click "${submit.name}" (--ref ${submit.ref}), then check the page changed.`;
      }
    }

    if (failed.length) {
      result.failed = failed.map(f => f.field);
      if (result.filled === 0) {
        // Nothing matched at all: the likely cause is being on a different page than expected,
        // not a mistyped name. Suggesting a --ref retry here sends the caller looking for fields
        // that are not on this page in any form.
        const present = all.filter(e => COMMAND_FOR_ROLE[e.role]).map(e => `"${e.name}"`).slice(0, 8);
        result.hint = `None of these fields are on this page. You are on ${result.url}, which has: ${present.join(", ") || "no fillable fields"}. That is probably not the page you expected -- check where your last action left you before filling.`;
      } else {
        result.hint = `Filled ${result.filled} of ${results.length}. ${failed.map(f => `"${f.field}"`).join(", ")} did not fill and ${failed.length === 1 ? "is" : "are"} unchanged -- the elements below show the current page; retry those with --ref, or a single-field command.`;
      }
    }
    // Always return the page state, whatever the session's snapshot mode: after filling a form
    // the caller needs to see what the page looks like now, especially when something failed.
    return this._attachSnapshot(session, result, "auto");
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
    const timeout = parseInt(params.timeout) || 5000;
    const role = params.role || "combobox";
    const locator = params.ref != null
      ? await this._locatorForRef(session, params.ref)
      : this.getBase(session, params).getByRole(role, { name: params.name });
    return this._withTargetFailure(session, role, params.name, () => locator.selectOption(params.value, { timeout }));
  }

  async check(sessionId, params) {
    const session = this.getSession(sessionId);
    const timeout = parseInt(params.timeout) || 5000;
    const role = params.role || "checkbox";
    const locator = params.ref != null
      ? await this._locatorForRef(session, params.ref)
      : this.getBase(session, params).getByRole(role, { name: params.name });
    return this._withTargetFailure(session, role, params.name, () => locator.check({ timeout }));
  }

  async uncheck(sessionId, params) {
    const session = this.getSession(sessionId);
    const timeout = parseInt(params.timeout) || 5000;
    const role = params.role || "checkbox";
    const locator = params.ref != null
      ? await this._locatorForRef(session, params.ref)
      : this.getBase(session, params).getByRole(role, { name: params.name });
    return this._withTargetFailure(session, role, params.name, () => locator.uncheck({ timeout }));
  }

  async hover(sessionId, params) {
    const session = this.getSession(sessionId);
    const timeout = parseInt(params.timeout) || 5000;
    const role = params.role || "button";
    const locator = params.ref != null
      ? await this._locatorForRef(session, params.ref)
      : this.getBase(session, params).getByRole(role, { name: params.name });
    return this._withTargetFailure(session, role, params.name, () => locator.hover({ timeout }));
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

let browsers;

function getBrowsers() {
  if (!browsers) {
    const require = createRequire(import.meta.url);
    const { chromium, firefox, webkit } = require("playwright");
    browsers = { chromium, firefox, webkit };
  }
  return browsers;
}

class BrowserEngine {
  static async launch(options = {}) {
    const { channel, browser: browserName, headed, ...launchOptions } = options;
    const available = getBrowsers();
    const engine = available[browserName] || available.chromium;
    if (channel) launchOptions.channel = channel;
    // headed (visible) Chrome dramatically lowers bot-detection vs headless
    return engine.launch({ headless: !headed, ...launchOptions });
  }
}

let engines;

function getEngines() {
  if (!engines) {
    try {
      const require = createRequire(import.meta.url);
      const { chromium, firefox, webkit } = require("playwright");
      engines = { chromium, firefox, webkit };
    } catch {
      engines = {};
    }
  }
  return engines;
}

function normalizeBrowserName(browserName) {
  return getEngines()[browserName] ? browserName : "chromium";
}

/**
 * Returns true when Playwright's browser executable for the given engine is
 * present on disk. Never throws — a missing/uninstalled browser reports false.
 */
function isBrowserInstalled(browserName = "chromium") {
  try {
    const engine = getEngines()[normalizeBrowserName(browserName)];
    if (!engine) return false;
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

const DEFAULT_TIMEOUT = 600000;

/**
 * Chrome-backed implementation of the browser session contract.
 *
 * The daemon owns logical sessions while the extension owns real Chrome tabs.
 * A session remembers the target tab returned by `open`; a window-scoped
 * `list`/`open` can therefore be followed by stable tab-scoped actions.
 */
class ExtensionSessionManager {
  constructor(bridge, options = {}) {
    this.bridge = bridge;
    this.sessions = new Map();
    this.maxSessions = options.maxSessions || 20;
    this.onEmpty = options.onEmpty || (() => {});
    this.snapshotMode = "auto";
  }

  parseTimeout(value) {
    if (!value) return DEFAULT_TIMEOUT;
    const match = String(value).match(/^(\d+)(ms|s|m|h)?$/);
    if (!match) return DEFAULT_TIMEOUT;
    const n = parseInt(match[1], 10);
    return match[2] === "ms" ? n : match[2] === "s" ? n * 1000 : match[2] === "h" ? n * 3600000 : n * 60000;
  }

  resetTimer(session) {
    clearTimeout(session.timer);
    session.timer = setTimeout(() => this.close(session.id).catch(() => {}), session.timeout);
  }

  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    this.resetTimer(session);
    return session;
  }

  _rememberTarget(session, result) {
    const target = result?.target || result?.tab?.target;
    if (target) session.target = target;
    return result;
  }

  async _relay(method, sessionId, params = {}) {
    const session = this.getSession(sessionId);
    const result = await this.bridge.send(method, {
      ...params,
      target: session.target,
      snapshotMode: session.snapshotMode,
      session: sessionId
    });
    return this._rememberTarget(session, result);
  }

  async open(params = {}) {
    if (this.sessions.size >= this.maxSessions) throw new Error(`Max sessions (${this.maxSessions}) reached`);

    const result = await this.bridge.send("open", {
      url: params.url,
      waitUntil: params.waitUntil,
      target: params.target
    });
    const id = `ext-${crypto.randomBytes(4).toString("hex")}`;
    const session = {
      id,
      target: result.target || { scope: "window" },
      timeout: this.parseTimeout(params.timeout || "10m"),
      snapshotMode: params.snapshot || "off",
      createdAt: Date.now(),
      timer: null,
      scope: null
    };
    session.timer = setTimeout(() => this.close(id).catch(() => {}), session.timeout);
    this.sessions.set(id, session);

    const output = { sessionId: id, finalUrl: result.url, title: result.title };
    if (session.snapshotMode !== "off") {
      const snapshot = await this.snapshot(id, { mode: session.snapshotMode });
      output.snapshot = snapshot.snapshot || snapshot.text;
    }
    return output;
  }

  async close(sessionId) {
    const session = this.getSession(sessionId);
    clearTimeout(session.timer);
    try { await this.bridge.send("close", { target: session.target, session: sessionId }); } catch {}
    this.sessions.delete(sessionId);
    if (this.sessions.size === 0) this.onEmpty();
    return { status: "closed" };
  }

  list() {
    return this.bridge.send("list", {});
  }

  async visit(sessionId, url, waitUntil) {
    return this._relay("visit", sessionId, { url, waitUntil });
  }

  async back(sessionId) { return this._relay("back", sessionId); }
  async forward(sessionId) { return this._relay("forward", sessionId); }
  async reload(sessionId) { return this._relay("reload", sessionId); }

  async snapshot(sessionId, params = {}) {
    const result = await this._relay("snapshot", sessionId, { mode: params.mode || "auto" });
    if (params.output) {
      const text = SnapshotBuilder.render(result.snapshot);
      fs.writeFileSync(params.output, text, "utf8");
      return {
        status: "ok",
        path: params.output,
        title: result.snapshot?.title,
        url: result.snapshot?.url,
        elementCount: result.snapshot?.elements?.length || 0,
        componentCount: result.snapshot?.components?.length || 0
      };
    }
    if (params.format === "text") return { status: "ok", text: SnapshotBuilder.render(result.snapshot) };
    return { status: "ok", snapshot: result.snapshot };
  }

  async content(sessionId, params = {}) {
    const result = await this._relay("content", sessionId, params);
    if (!params.output) return result;
    fs.writeFileSync(params.output, result.content || "", "utf8");
    return {
      status: "ok",
      path: params.output,
      contentLength: (result.content || "").length,
      preview: (result.content || "").split("\n").find((line) => line.trim())?.slice(0, 120) || ""
    };
  }

  async read(params = {}) {
    if (!params.url) throw new Error("read: --url is required");
    let sessionId = params.session;
    let created = false;
    if (!sessionId) {
      const opened = await this.open({ snapshot: "off" });
      sessionId = opened.sessionId;
      created = true;
    }
    await this.visit(sessionId, params.url, params.waitUntil || "load");
    const content = await this.content(sessionId, { format: params.format === "html" ? "html" : "text" });
    const result = { status: "ok", url: params.url, content: content.content || "" };
    if (params.output) {
      fs.writeFileSync(params.output, result.content, "utf8");
      delete result.content;
      result.path = params.output;
      result.contentLength = fs.statSync(params.output).size;
    }
    if (created) {
      await this.close(sessionId);
      result.sessionClosed = true;
    } else {
      result.sessionId = sessionId;
    }
    return result;
  }

  async screenshot(sessionId, params = {}) {
    const result = await this._relay("screenshot", sessionId, params);
    if (result.status === "unsupported") return result;
    const output = params.output || "screenshot.png";
    const comma = String(result.dataUrl || "").indexOf(",");
    if (comma < 0) throw new Error("Chrome returned an invalid screenshot");
    fs.writeFileSync(output, Buffer.from(String(result.dataUrl).slice(comma + 1), "base64"));
    return { status: "ok", path: output };
  }

  async upload(sessionId, params = {}) {
    if (!params.file) throw new Error("upload: --file is required");
    const data = fs.readFileSync(params.file).toString("base64");
    return this._relay("upload", sessionId, {
      ...params,
      data,
      fileName: path.basename(params.file),
      mimeType: "application/octet-stream"
    });
  }

  async cookies(sessionId, params = {}) {
    const session = this.getSession(sessionId);
    if (params.export) {
      const result = await this.bridge.send("cookies", { target: session.target });
      fs.writeFileSync(params.export, JSON.stringify(result.cookies || [], null, 2));
      return { status: "exported", path: params.export, count: (result.cookies || []).length };
    }
    if (params.import) {
      const cookies = JSON.parse(fs.readFileSync(params.import, "utf8"));
      return this.bridge.send("cookies", { target: session.target, action: "set", cookies });
    }
    return this.bridge.send("cookies", { target: session.target, url: params.url });
  }

  async evaluate() {
    return {
      status: "unsupported",
      backend: "extension",
      reason: "MV3 blocks arbitrary eval in extension-injected code; use selectors, expectations, or the page command surface"
    };
  }
  async wait(sessionId, params) { return this._relay("wait", sessionId, params); }
  async expect(sessionId, params) { return this._relay("expect", sessionId, params); }
  async expectList(sessionId, params) { return this._relay("expect-list", sessionId, params); }
  async getItems(sessionId, params) { return this._relay("get-items", sessionId, params); }
  async component(sessionId, params) { return this._relay("component", sessionId, params); }

  async click(sessionId, params) { return this._relay("click", sessionId, params); }
  async clickSelector(sessionId, params) { return this._relay("click-selector", sessionId, params); }
  async mouse(sessionId, params) { return this._relay("mouse", sessionId, params); }
  async clickText(sessionId, params) { return this._relay("click-text", sessionId, params); }
  async type(sessionId, params) { return this._relay("type", sessionId, params); }
  async scroll(sessionId, params) { return this._relay("scroll", sessionId, params); }
  async fill(sessionId, params) { return this._relay("fill", sessionId, params); }
  async select(sessionId, params) { return this._relay("select", sessionId, params); }
  async check(sessionId, params) { return this._relay("check", sessionId, params); }
  async uncheck(sessionId, params) { return this._relay("uncheck", sessionId, params); }
  async hover(sessionId, params) { return this._relay("hover", sessionId, params); }
  async press(sessionId, params) { return this._relay("press", sessionId, params); }
  async clear(sessionId, params) { return this._relay("clear", sessionId, params); }
  async setScope(sessionId, selector) { const session = this.getSession(sessionId); session.scope = selector; return { status: "ok", scope: selector }; }
  async clearScope(sessionId) { const session = this.getSession(sessionId); session.scope = null; return { status: "ok" }; }
  async setSnapshot(sessionId, mode) { const session = this.getSession(sessionId); session.snapshotMode = mode || "off"; return { status: "ok", snapshot: session.snapshotMode }; }

  async newTab(sessionId, url) { return this._relay("new-tab", sessionId, { url }); }
  async switchTab(sessionId, tab) { return this._relay("switch-tab", sessionId, { tab }); }
  async closeTab(sessionId, tab) { return this._relay("close-tab", sessionId, { tab }); }
  async listTabs(sessionId) { return this._relay("list-tabs", sessionId); }
  async download(sessionId, params) { return this._relay("download", sessionId, params); }

  async savePdf() {
    return { status: "unsupported", backend: "extension", reason: "Chrome does not expose print-to-PDF to MV3 extensions without debugger access" };
  }

  async execute(sessionId, instructions = []) {
    const completed = [];
    for (let index = 0; index < instructions.length; index++) {
      const { method, params = {} } = instructions[index];
      try {
        const result = await this.handleMethod(sessionId, method, params);
        completed.push({ index, method, result });
      } catch (error) {
        return { error: error.message, failedIndex: index, failedInstruction: JSON.stringify(instructions[index]), completedSteps: completed.length };
      }
    }
    return { status: "ok", completedSteps: completed.length, results: completed };
  }

  async handleMethod(sessionId, method, params = {}) {
    const methods = {
      visit: () => this.visit(sessionId, params.url, params.waitUntil), back: () => this.back(sessionId),
      forward: () => this.forward(sessionId), reload: () => this.reload(sessionId),
      click: () => this.click(sessionId, params), "click-selector": () => this.clickSelector(sessionId, params),
      mouse: () => this.mouse(sessionId, params), "click-text": () => this.clickText(sessionId, params),
      "click-item": () => this._relay("click-item", sessionId, params), type: () => this.type(sessionId, params),
      scroll: () => this.scroll(sessionId, params), content: () => this.content(sessionId, params),
      screenshot: () => this.screenshot(sessionId, params), wait: () => this.wait(sessionId, params),
      eval: () => this.evaluate(sessionId, params.script), expect: () => this.expect(sessionId, params),
      "expect-list": () => this.expectList(sessionId, params), "get-items": () => this.getItems(sessionId, params),
      fill: () => this.fill(sessionId, params), select: () => this.select(sessionId, params),
      check: () => this.check(sessionId, params), uncheck: () => this.uncheck(sessionId, params),
      hover: () => this.hover(sessionId, params), press: () => this.press(sessionId, params),
      clear: () => this.clear(sessionId, params), upload: () => this.upload(sessionId, params),
      "set-scope": () => this.setScope(sessionId, params.selector), "clear-scope": () => this.clearScope(sessionId),
      "set-snapshot": () => this.setSnapshot(sessionId, params.mode), read: () => this.read({ ...params, session: sessionId }),
      component: () => this.component(sessionId, params), "new-tab": () => this.newTab(sessionId, params.url),
      "switch-tab": () => this.switchTab(sessionId, params.tab), "close-tab": () => this.closeTab(sessionId, params.tab),
      "list-tabs": () => this.listTabs(sessionId), download: () => this.download(sessionId, params)
    };
    if (!methods[method]) throw new Error(`Unknown method in execute: ${method}`);
    return methods[method]();
  }

  getSessionForError(sessionId) { return this.sessions.get(sessionId) || null; }
  screenshotOnError() { return null; }

  async closeAll() {
    for (const session of this.sessions.values()) clearTimeout(session.timer);
    this.sessions.clear();
  }
}

function getDefaultExportFromCjs (x) {
	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
}

var bufferUtil = {exports: {}};

var constants;
var hasRequiredConstants;

function requireConstants () {
	if (hasRequiredConstants) return constants;
	hasRequiredConstants = 1;

	const BINARY_TYPES = ['nodebuffer', 'arraybuffer', 'fragments'];
	const hasBlob = typeof Blob !== 'undefined';

	if (hasBlob) BINARY_TYPES.push('blob');

	constants = {
	  BINARY_TYPES,
	  CLOSE_TIMEOUT: 30000,
	  EMPTY_BUFFER: Buffer.alloc(0),
	  GUID: '258EAFA5-E914-47DA-95CA-C5AB0DC85B11',
	  hasBlob,
	  kForOnEventAttribute: Symbol('kIsForOnEventAttribute'),
	  kListener: Symbol('kListener'),
	  kStatusCode: Symbol('status-code'),
	  kWebSocket: Symbol('websocket'),
	  NOOP: () => {}
	};
	return constants;
}

var hasRequiredBufferUtil;

function requireBufferUtil () {
	if (hasRequiredBufferUtil) return bufferUtil.exports;
	hasRequiredBufferUtil = 1;

	const { EMPTY_BUFFER } = requireConstants();

	const FastBuffer = Buffer[Symbol.species];

	/**
	 * Merges an array of buffers into a new buffer.
	 *
	 * @param {Buffer[]} list The array of buffers to concat
	 * @param {Number} totalLength The total length of buffers in the list
	 * @return {Buffer} The resulting buffer
	 * @public
	 */
	function concat(list, totalLength) {
	  if (list.length === 0) return EMPTY_BUFFER;
	  if (list.length === 1) return list[0];

	  const target = Buffer.allocUnsafe(totalLength);
	  let offset = 0;

	  for (let i = 0; i < list.length; i++) {
	    const buf = list[i];
	    target.set(buf, offset);
	    offset += buf.length;
	  }

	  if (offset < totalLength) {
	    return new FastBuffer(target.buffer, target.byteOffset, offset);
	  }

	  return target;
	}

	/**
	 * Masks a buffer using the given mask.
	 *
	 * @param {Buffer} source The buffer to mask
	 * @param {Buffer} mask The mask to use
	 * @param {Buffer} output The buffer where to store the result
	 * @param {Number} offset The offset at which to start writing
	 * @param {Number} length The number of bytes to mask.
	 * @public
	 */
	function _mask(source, mask, output, offset, length) {
	  for (let i = 0; i < length; i++) {
	    output[offset + i] = source[i] ^ mask[i & 3];
	  }
	}

	/**
	 * Unmasks a buffer using the given mask.
	 *
	 * @param {Buffer} buffer The buffer to unmask
	 * @param {Buffer} mask The mask to use
	 * @public
	 */
	function _unmask(buffer, mask) {
	  for (let i = 0; i < buffer.length; i++) {
	    buffer[i] ^= mask[i & 3];
	  }
	}

	/**
	 * Converts a buffer to an `ArrayBuffer`.
	 *
	 * @param {Buffer} buf The buffer to convert
	 * @return {ArrayBuffer} Converted buffer
	 * @public
	 */
	function toArrayBuffer(buf) {
	  if (buf.length === buf.buffer.byteLength) {
	    return buf.buffer;
	  }

	  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
	}

	/**
	 * Converts `data` to a `Buffer`.
	 *
	 * @param {*} data The data to convert
	 * @return {Buffer} The buffer
	 * @throws {TypeError}
	 * @public
	 */
	function toBuffer(data) {
	  toBuffer.readOnly = true;

	  if (Buffer.isBuffer(data)) return data;

	  let buf;

	  if (data instanceof ArrayBuffer) {
	    buf = new FastBuffer(data);
	  } else if (ArrayBuffer.isView(data)) {
	    buf = new FastBuffer(data.buffer, data.byteOffset, data.byteLength);
	  } else {
	    buf = Buffer.from(data);
	    toBuffer.readOnly = false;
	  }

	  return buf;
	}

	bufferUtil.exports = {
	  concat,
	  mask: _mask,
	  toArrayBuffer,
	  toBuffer,
	  unmask: _unmask
	};

	/* istanbul ignore else  */
	if (!process.env.WS_NO_BUFFER_UTIL) {
	  try {
	    const bufferUtil$1 = require('bufferutil');

	    bufferUtil.exports.mask = function (source, mask, output, offset, length) {
	      if (length < 48) _mask(source, mask, output, offset, length);
	      else bufferUtil$1.mask(source, mask, output, offset, length);
	    };

	    bufferUtil.exports.unmask = function (buffer, mask) {
	      if (buffer.length < 32) _unmask(buffer, mask);
	      else bufferUtil$1.unmask(buffer, mask);
	    };
	  } catch (e) {
	    // Continue regardless of the error.
	  }
	}
	return bufferUtil.exports;
}

var limiter;
var hasRequiredLimiter;

function requireLimiter () {
	if (hasRequiredLimiter) return limiter;
	hasRequiredLimiter = 1;

	const kDone = Symbol('kDone');
	const kRun = Symbol('kRun');

	/**
	 * A very simple job queue with adjustable concurrency. Adapted from
	 * https://github.com/STRML/async-limiter
	 */
	class Limiter {
	  /**
	   * Creates a new `Limiter`.
	   *
	   * @param {Number} [concurrency=Infinity] The maximum number of jobs allowed
	   *     to run concurrently
	   */
	  constructor(concurrency) {
	    this[kDone] = () => {
	      this.pending--;
	      this[kRun]();
	    };
	    this.concurrency = concurrency || Infinity;
	    this.jobs = [];
	    this.pending = 0;
	  }

	  /**
	   * Adds a job to the queue.
	   *
	   * @param {Function} job The job to run
	   * @public
	   */
	  add(job) {
	    this.jobs.push(job);
	    this[kRun]();
	  }

	  /**
	   * Removes a job from the queue and runs it if possible.
	   *
	   * @private
	   */
	  [kRun]() {
	    if (this.pending === this.concurrency) return;

	    if (this.jobs.length) {
	      const job = this.jobs.shift();

	      this.pending++;
	      job(this[kDone]);
	    }
	  }
	}

	limiter = Limiter;
	return limiter;
}

var permessageDeflate;
var hasRequiredPermessageDeflate;

function requirePermessageDeflate () {
	if (hasRequiredPermessageDeflate) return permessageDeflate;
	hasRequiredPermessageDeflate = 1;

	const zlib = require$$0;

	const bufferUtil = requireBufferUtil();
	const Limiter = requireLimiter();
	const { kStatusCode } = requireConstants();

	const FastBuffer = Buffer[Symbol.species];
	const TRAILER = Buffer.from([0x00, 0x00, 0xff, 0xff]);
	const kPerMessageDeflate = Symbol('permessage-deflate');
	const kTotalLength = Symbol('total-length');
	const kCallback = Symbol('callback');
	const kBuffers = Symbol('buffers');
	const kError = Symbol('error');

	//
	// We limit zlib concurrency, which prevents severe memory fragmentation
	// as documented in https://github.com/nodejs/node/issues/8871#issuecomment-250915913
	// and https://github.com/websockets/ws/issues/1202
	//
	// Intentionally global; it's the global thread pool that's an issue.
	//
	let zlibLimiter;

	/**
	 * permessage-deflate implementation.
	 */
	class PerMessageDeflate {
	  /**
	   * Creates a PerMessageDeflate instance.
	   *
	   * @param {Object} [options] Configuration options
	   * @param {(Boolean|Number)} [options.clientMaxWindowBits] Advertise support
	   *     for, or request, a custom client window size
	   * @param {Boolean} [options.clientNoContextTakeover=false] Advertise/
	   *     acknowledge disabling of client context takeover
	   * @param {Number} [options.concurrencyLimit=10] The number of concurrent
	   *     calls to zlib
	   * @param {Boolean} [options.isServer=false] Create the instance in either
	   *     server or client mode
	   * @param {Number} [options.maxPayload=0] The maximum allowed message length
	   * @param {(Boolean|Number)} [options.serverMaxWindowBits] Request/confirm the
	   *     use of a custom server window size
	   * @param {Boolean} [options.serverNoContextTakeover=false] Request/accept
	   *     disabling of server context takeover
	   * @param {Number} [options.threshold=1024] Size (in bytes) below which
	   *     messages should not be compressed if context takeover is disabled
	   * @param {Object} [options.zlibDeflateOptions] Options to pass to zlib on
	   *     deflate
	   * @param {Object} [options.zlibInflateOptions] Options to pass to zlib on
	   *     inflate
	   */
	  constructor(options) {
	    this._options = options || {};
	    this._threshold =
	      this._options.threshold !== undefined ? this._options.threshold : 1024;
	    this._maxPayload = this._options.maxPayload | 0;
	    this._isServer = !!this._options.isServer;
	    this._deflate = null;
	    this._inflate = null;

	    this.params = null;

	    if (!zlibLimiter) {
	      const concurrency =
	        this._options.concurrencyLimit !== undefined
	          ? this._options.concurrencyLimit
	          : 10;
	      zlibLimiter = new Limiter(concurrency);
	    }
	  }

	  /**
	   * @type {String}
	   */
	  static get extensionName() {
	    return 'permessage-deflate';
	  }

	  /**
	   * Create an extension negotiation offer.
	   *
	   * @return {Object} Extension parameters
	   * @public
	   */
	  offer() {
	    const params = {};

	    if (this._options.serverNoContextTakeover) {
	      params.server_no_context_takeover = true;
	    }
	    if (this._options.clientNoContextTakeover) {
	      params.client_no_context_takeover = true;
	    }
	    if (this._options.serverMaxWindowBits) {
	      params.server_max_window_bits = this._options.serverMaxWindowBits;
	    }
	    if (this._options.clientMaxWindowBits) {
	      params.client_max_window_bits = this._options.clientMaxWindowBits;
	    } else if (this._options.clientMaxWindowBits == null) {
	      params.client_max_window_bits = true;
	    }

	    return params;
	  }

	  /**
	   * Accept an extension negotiation offer/response.
	   *
	   * @param {Array} configurations The extension negotiation offers/reponse
	   * @return {Object} Accepted configuration
	   * @public
	   */
	  accept(configurations) {
	    configurations = this.normalizeParams(configurations);

	    this.params = this._isServer
	      ? this.acceptAsServer(configurations)
	      : this.acceptAsClient(configurations);

	    return this.params;
	  }

	  /**
	   * Releases all resources used by the extension.
	   *
	   * @public
	   */
	  cleanup() {
	    if (this._inflate) {
	      this._inflate.close();
	      this._inflate = null;
	    }

	    if (this._deflate) {
	      const callback = this._deflate[kCallback];

	      this._deflate.close();
	      this._deflate = null;

	      if (callback) {
	        callback(
	          new Error(
	            'The deflate stream was closed while data was being processed'
	          )
	        );
	      }
	    }
	  }

	  /**
	   *  Accept an extension negotiation offer.
	   *
	   * @param {Array} offers The extension negotiation offers
	   * @return {Object} Accepted configuration
	   * @private
	   */
	  acceptAsServer(offers) {
	    const opts = this._options;
	    const accepted = offers.find((params) => {
	      if (
	        (opts.serverNoContextTakeover === false &&
	          params.server_no_context_takeover) ||
	        (params.server_max_window_bits &&
	          (opts.serverMaxWindowBits === false ||
	            (typeof opts.serverMaxWindowBits === 'number' &&
	              opts.serverMaxWindowBits > params.server_max_window_bits))) ||
	        (typeof opts.clientMaxWindowBits === 'number' &&
	          (typeof params.client_max_window_bits === 'number'
	            ? opts.clientMaxWindowBits > params.client_max_window_bits
	            : !params.client_max_window_bits))
	      ) {
	        return false;
	      }

	      return true;
	    });

	    if (!accepted) {
	      throw new Error('None of the extension offers can be accepted');
	    }

	    if (opts.serverNoContextTakeover) {
	      accepted.server_no_context_takeover = true;
	    }
	    if (opts.clientNoContextTakeover) {
	      accepted.client_no_context_takeover = true;
	    }
	    if (typeof opts.serverMaxWindowBits === 'number') {
	      accepted.server_max_window_bits = opts.serverMaxWindowBits;
	    }
	    if (typeof opts.clientMaxWindowBits === 'number') {
	      accepted.client_max_window_bits = opts.clientMaxWindowBits;
	    } else if (
	      accepted.client_max_window_bits === true ||
	      opts.clientMaxWindowBits === false
	    ) {
	      delete accepted.client_max_window_bits;
	    }

	    return accepted;
	  }

	  /**
	   * Accept the extension negotiation response.
	   *
	   * @param {Array} response The extension negotiation response
	   * @return {Object} Accepted configuration
	   * @private
	   */
	  acceptAsClient(response) {
	    const params = response[0];

	    if (
	      this._options.clientNoContextTakeover === false &&
	      params.client_no_context_takeover
	    ) {
	      throw new Error('Unexpected parameter "client_no_context_takeover"');
	    }

	    if (!params.client_max_window_bits) {
	      if (typeof this._options.clientMaxWindowBits === 'number') {
	        params.client_max_window_bits = this._options.clientMaxWindowBits;
	      }
	    } else if (
	      this._options.clientMaxWindowBits === false ||
	      (typeof this._options.clientMaxWindowBits === 'number' &&
	        params.client_max_window_bits > this._options.clientMaxWindowBits)
	    ) {
	      throw new Error(
	        'Unexpected or invalid parameter "client_max_window_bits"'
	      );
	    }

	    return params;
	  }

	  /**
	   * Normalize parameters.
	   *
	   * @param {Array} configurations The extension negotiation offers/reponse
	   * @return {Array} The offers/response with normalized parameters
	   * @private
	   */
	  normalizeParams(configurations) {
	    configurations.forEach((params) => {
	      Object.keys(params).forEach((key) => {
	        let value = params[key];

	        if (value.length > 1) {
	          throw new Error(`Parameter "${key}" must have only a single value`);
	        }

	        value = value[0];

	        if (key === 'client_max_window_bits') {
	          if (value !== true) {
	            const num = +value;
	            if (!Number.isInteger(num) || num < 8 || num > 15) {
	              throw new TypeError(
	                `Invalid value for parameter "${key}": ${value}`
	              );
	            }
	            value = num;
	          } else if (!this._isServer) {
	            throw new TypeError(
	              `Invalid value for parameter "${key}": ${value}`
	            );
	          }
	        } else if (key === 'server_max_window_bits') {
	          const num = +value;
	          if (!Number.isInteger(num) || num < 8 || num > 15) {
	            throw new TypeError(
	              `Invalid value for parameter "${key}": ${value}`
	            );
	          }
	          value = num;
	        } else if (
	          key === 'client_no_context_takeover' ||
	          key === 'server_no_context_takeover'
	        ) {
	          if (value !== true) {
	            throw new TypeError(
	              `Invalid value for parameter "${key}": ${value}`
	            );
	          }
	        } else {
	          throw new Error(`Unknown parameter "${key}"`);
	        }

	        params[key] = value;
	      });
	    });

	    return configurations;
	  }

	  /**
	   * Decompress data. Concurrency limited.
	   *
	   * @param {Buffer} data Compressed data
	   * @param {Boolean} fin Specifies whether or not this is the last fragment
	   * @param {Function} callback Callback
	   * @public
	   */
	  decompress(data, fin, callback) {
	    zlibLimiter.add((done) => {
	      this._decompress(data, fin, (err, result) => {
	        done();
	        callback(err, result);
	      });
	    });
	  }

	  /**
	   * Compress data. Concurrency limited.
	   *
	   * @param {(Buffer|String)} data Data to compress
	   * @param {Boolean} fin Specifies whether or not this is the last fragment
	   * @param {Function} callback Callback
	   * @public
	   */
	  compress(data, fin, callback) {
	    zlibLimiter.add((done) => {
	      this._compress(data, fin, (err, result) => {
	        done();
	        callback(err, result);
	      });
	    });
	  }

	  /**
	   * Decompress data.
	   *
	   * @param {Buffer} data Compressed data
	   * @param {Boolean} fin Specifies whether or not this is the last fragment
	   * @param {Function} callback Callback
	   * @private
	   */
	  _decompress(data, fin, callback) {
	    const endpoint = this._isServer ? 'client' : 'server';

	    if (!this._inflate) {
	      const key = `${endpoint}_max_window_bits`;
	      const windowBits =
	        typeof this.params[key] !== 'number'
	          ? zlib.Z_DEFAULT_WINDOWBITS
	          : this.params[key];

	      this._inflate = zlib.createInflateRaw({
	        ...this._options.zlibInflateOptions,
	        windowBits
	      });
	      this._inflate[kPerMessageDeflate] = this;
	      this._inflate[kTotalLength] = 0;
	      this._inflate[kBuffers] = [];
	      this._inflate.on('error', inflateOnError);
	      this._inflate.on('data', inflateOnData);
	    }

	    this._inflate[kCallback] = callback;

	    this._inflate.write(data);
	    if (fin) this._inflate.write(TRAILER);

	    this._inflate.flush(() => {
	      const err = this._inflate[kError];

	      if (err) {
	        this._inflate.close();
	        this._inflate = null;
	        callback(err);
	        return;
	      }

	      const data = bufferUtil.concat(
	        this._inflate[kBuffers],
	        this._inflate[kTotalLength]
	      );

	      if (this._inflate._readableState.endEmitted) {
	        this._inflate.close();
	        this._inflate = null;
	      } else {
	        this._inflate[kTotalLength] = 0;
	        this._inflate[kBuffers] = [];

	        if (fin && this.params[`${endpoint}_no_context_takeover`]) {
	          this._inflate.reset();
	        }
	      }

	      callback(null, data);
	    });
	  }

	  /**
	   * Compress data.
	   *
	   * @param {(Buffer|String)} data Data to compress
	   * @param {Boolean} fin Specifies whether or not this is the last fragment
	   * @param {Function} callback Callback
	   * @private
	   */
	  _compress(data, fin, callback) {
	    const endpoint = this._isServer ? 'server' : 'client';

	    if (!this._deflate) {
	      const key = `${endpoint}_max_window_bits`;
	      const windowBits =
	        typeof this.params[key] !== 'number'
	          ? zlib.Z_DEFAULT_WINDOWBITS
	          : this.params[key];

	      this._deflate = zlib.createDeflateRaw({
	        ...this._options.zlibDeflateOptions,
	        windowBits
	      });

	      this._deflate[kTotalLength] = 0;
	      this._deflate[kBuffers] = [];

	      this._deflate.on('data', deflateOnData);
	    }

	    this._deflate[kCallback] = callback;

	    this._deflate.write(data);
	    this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
	      if (!this._deflate) {
	        //
	        // The deflate stream was closed while data was being processed.
	        //
	        return;
	      }

	      let data = bufferUtil.concat(
	        this._deflate[kBuffers],
	        this._deflate[kTotalLength]
	      );

	      if (fin) {
	        data = new FastBuffer(data.buffer, data.byteOffset, data.length - 4);
	      }

	      //
	      // Ensure that the callback will not be called again in
	      // `PerMessageDeflate#cleanup()`.
	      //
	      this._deflate[kCallback] = null;

	      this._deflate[kTotalLength] = 0;
	      this._deflate[kBuffers] = [];

	      if (fin && this.params[`${endpoint}_no_context_takeover`]) {
	        this._deflate.reset();
	      }

	      callback(null, data);
	    });
	  }
	}

	permessageDeflate = PerMessageDeflate;

	/**
	 * The listener of the `zlib.DeflateRaw` stream `'data'` event.
	 *
	 * @param {Buffer} chunk A chunk of data
	 * @private
	 */
	function deflateOnData(chunk) {
	  this[kBuffers].push(chunk);
	  this[kTotalLength] += chunk.length;
	}

	/**
	 * The listener of the `zlib.InflateRaw` stream `'data'` event.
	 *
	 * @param {Buffer} chunk A chunk of data
	 * @private
	 */
	function inflateOnData(chunk) {
	  this[kTotalLength] += chunk.length;

	  if (
	    this[kPerMessageDeflate]._maxPayload < 1 ||
	    this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload
	  ) {
	    this[kBuffers].push(chunk);
	    return;
	  }

	  this[kError] = new RangeError('Max payload size exceeded');
	  this[kError].code = 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH';
	  this[kError][kStatusCode] = 1009;
	  this.removeListener('data', inflateOnData);

	  //
	  // The choice to employ `zlib.reset()` over `zlib.close()` is dictated by the
	  // fact that in Node.js versions prior to 13.10.0, the callback for
	  // `zlib.flush()` is not called if `zlib.close()` is used. Utilizing
	  // `zlib.reset()` ensures that either the callback is invoked or an error is
	  // emitted.
	  //
	  this.reset();
	}

	/**
	 * The listener of the `zlib.InflateRaw` stream `'error'` event.
	 *
	 * @param {Error} err The emitted error
	 * @private
	 */
	function inflateOnError(err) {
	  //
	  // There is no need to call `Zlib#close()` as the handle is automatically
	  // closed when an error is emitted.
	  //
	  this[kPerMessageDeflate]._inflate = null;

	  if (this[kError]) {
	    this[kCallback](this[kError]);
	    return;
	  }

	  err[kStatusCode] = 1007;
	  this[kCallback](err);
	}
	return permessageDeflate;
}

var validation = {exports: {}};

var hasRequiredValidation;

function requireValidation () {
	if (hasRequiredValidation) return validation.exports;
	hasRequiredValidation = 1;

	const { isUtf8 } = require$$0$1;

	const { hasBlob } = requireConstants();

	//
	// Allowed token characters:
	//
	// '!', '#', '$', '%', '&', ''', '*', '+', '-',
	// '.', 0-9, A-Z, '^', '_', '`', a-z, '|', '~'
	//
	// tokenChars[32] === 0 // ' '
	// tokenChars[33] === 1 // '!'
	// tokenChars[34] === 0 // '"'
	// ...
	//
	// prettier-ignore
	const tokenChars = [
	  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 0 - 15
	  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 16 - 31
	  0, 1, 0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0, // 32 - 47
	  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, // 48 - 63
	  0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 64 - 79
	  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, // 80 - 95
	  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 96 - 111
	  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 0 // 112 - 127
	];

	/**
	 * Checks if a status code is allowed in a close frame.
	 *
	 * @param {Number} code The status code
	 * @return {Boolean} `true` if the status code is valid, else `false`
	 * @public
	 */
	function isValidStatusCode(code) {
	  return (
	    (code >= 1000 &&
	      code <= 1014 &&
	      code !== 1004 &&
	      code !== 1005 &&
	      code !== 1006) ||
	    (code >= 3000 && code <= 4999)
	  );
	}

	/**
	 * Checks if a given buffer contains only correct UTF-8.
	 * Ported from https://www.cl.cam.ac.uk/%7Emgk25/ucs/utf8_check.c by
	 * Markus Kuhn.
	 *
	 * @param {Buffer} buf The buffer to check
	 * @return {Boolean} `true` if `buf` contains only correct UTF-8, else `false`
	 * @public
	 */
	function _isValidUTF8(buf) {
	  const len = buf.length;
	  let i = 0;

	  while (i < len) {
	    if ((buf[i] & 0x80) === 0) {
	      // 0xxxxxxx
	      i++;
	    } else if ((buf[i] & 0xe0) === 0xc0) {
	      // 110xxxxx 10xxxxxx
	      if (
	        i + 1 === len ||
	        (buf[i + 1] & 0xc0) !== 0x80 ||
	        (buf[i] & 0xfe) === 0xc0 // Overlong
	      ) {
	        return false;
	      }

	      i += 2;
	    } else if ((buf[i] & 0xf0) === 0xe0) {
	      // 1110xxxx 10xxxxxx 10xxxxxx
	      if (
	        i + 2 >= len ||
	        (buf[i + 1] & 0xc0) !== 0x80 ||
	        (buf[i + 2] & 0xc0) !== 0x80 ||
	        (buf[i] === 0xe0 && (buf[i + 1] & 0xe0) === 0x80) || // Overlong
	        (buf[i] === 0xed && (buf[i + 1] & 0xe0) === 0xa0) // Surrogate (U+D800 - U+DFFF)
	      ) {
	        return false;
	      }

	      i += 3;
	    } else if ((buf[i] & 0xf8) === 0xf0) {
	      // 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx
	      if (
	        i + 3 >= len ||
	        (buf[i + 1] & 0xc0) !== 0x80 ||
	        (buf[i + 2] & 0xc0) !== 0x80 ||
	        (buf[i + 3] & 0xc0) !== 0x80 ||
	        (buf[i] === 0xf0 && (buf[i + 1] & 0xf0) === 0x80) || // Overlong
	        (buf[i] === 0xf4 && buf[i + 1] > 0x8f) ||
	        buf[i] > 0xf4 // > U+10FFFF
	      ) {
	        return false;
	      }

	      i += 4;
	    } else {
	      return false;
	    }
	  }

	  return true;
	}

	/**
	 * Determines whether a value is a `Blob`.
	 *
	 * @param {*} value The value to be tested
	 * @return {Boolean} `true` if `value` is a `Blob`, else `false`
	 * @private
	 */
	function isBlob(value) {
	  return (
	    hasBlob &&
	    typeof value === 'object' &&
	    typeof value.arrayBuffer === 'function' &&
	    typeof value.type === 'string' &&
	    typeof value.stream === 'function' &&
	    (value[Symbol.toStringTag] === 'Blob' ||
	      value[Symbol.toStringTag] === 'File')
	  );
	}

	validation.exports = {
	  isBlob,
	  isValidStatusCode,
	  isValidUTF8: _isValidUTF8,
	  tokenChars
	};

	if (isUtf8) {
	  validation.exports.isValidUTF8 = function (buf) {
	    return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
	  };
	} /* istanbul ignore else  */ else if (!process.env.WS_NO_UTF_8_VALIDATE) {
	  try {
	    const isValidUTF8 = require('utf-8-validate');

	    validation.exports.isValidUTF8 = function (buf) {
	      return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF8(buf);
	    };
	  } catch (e) {
	    // Continue regardless of the error.
	  }
	}
	return validation.exports;
}

var receiver;
var hasRequiredReceiver;

function requireReceiver () {
	if (hasRequiredReceiver) return receiver;
	hasRequiredReceiver = 1;

	const { Writable } = require$$0$2;

	const PerMessageDeflate = requirePermessageDeflate();
	const {
	  BINARY_TYPES,
	  EMPTY_BUFFER,
	  kStatusCode,
	  kWebSocket
	} = requireConstants();
	const { concat, toArrayBuffer, unmask } = requireBufferUtil();
	const { isValidStatusCode, isValidUTF8 } = requireValidation();

	const FastBuffer = Buffer[Symbol.species];

	const GET_INFO = 0;
	const GET_PAYLOAD_LENGTH_16 = 1;
	const GET_PAYLOAD_LENGTH_64 = 2;
	const GET_MASK = 3;
	const GET_DATA = 4;
	const INFLATING = 5;
	const DEFER_EVENT = 6;

	/**
	 * HyBi Receiver implementation.
	 *
	 * @extends Writable
	 */
	class Receiver extends Writable {
	  /**
	   * Creates a Receiver instance.
	   *
	   * @param {Object} [options] Options object
	   * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
	   *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
	   *     multiple times in the same tick
	   * @param {String} [options.binaryType=nodebuffer] The type for binary data
	   * @param {Object} [options.extensions] An object containing the negotiated
	   *     extensions
	   * @param {Boolean} [options.isServer=false] Specifies whether to operate in
	   *     client or server mode
	   * @param {Number} [options.maxBufferedChunks=0] The maximum number of
	   *     buffered data chunks
	   * @param {Number} [options.maxFragments=0] The maximum number of message
	   *     fragments
	   * @param {Number} [options.maxPayload=0] The maximum allowed message length
	   * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
	   *     not to skip UTF-8 validation for text and close messages
	   */
	  constructor(options = {}) {
	    super();

	    this._allowSynchronousEvents =
	      options.allowSynchronousEvents !== undefined
	        ? options.allowSynchronousEvents
	        : true;
	    this._binaryType = options.binaryType || BINARY_TYPES[0];
	    this._extensions = options.extensions || {};
	    this._isServer = !!options.isServer;
	    this._maxBufferedChunks = options.maxBufferedChunks | 0;
	    this._maxFragments = options.maxFragments | 0;
	    this._maxPayload = options.maxPayload | 0;
	    this._skipUTF8Validation = !!options.skipUTF8Validation;
	    this[kWebSocket] = undefined;

	    this._bufferedBytes = 0;
	    this._buffers = [];

	    this._compressed = false;
	    this._payloadLength = 0;
	    this._mask = undefined;
	    this._fragmented = 0;
	    this._masked = false;
	    this._fin = false;
	    this._opcode = 0;

	    this._totalPayloadLength = 0;
	    this._messageLength = 0;
	    this._numFragments = 0;
	    this._fragments = [];

	    this._errored = false;
	    this._loop = false;
	    this._state = GET_INFO;
	  }

	  /**
	   * Implements `Writable.prototype._write()`.
	   *
	   * @param {Buffer} chunk The chunk of data to write
	   * @param {String} encoding The character encoding of `chunk`
	   * @param {Function} cb Callback
	   * @private
	   */
	  _write(chunk, encoding, cb) {
	    if (this._opcode === 0x08 && this._state == GET_INFO) return cb();

	    if (
	      this._maxBufferedChunks > 0 &&
	      this._buffers.length >= this._maxBufferedChunks
	    ) {
	      cb(
	        this.createError(
	          RangeError,
	          'Too many buffered chunks',
	          false,
	          1008,
	          'WS_ERR_TOO_MANY_BUFFERED_PARTS'
	        )
	      );
	      return;
	    }

	    this._bufferedBytes += chunk.length;
	    this._buffers.push(chunk);
	    this.startLoop(cb);
	  }

	  /**
	   * Consumes `n` bytes from the buffered data.
	   *
	   * @param {Number} n The number of bytes to consume
	   * @return {Buffer} The consumed bytes
	   * @private
	   */
	  consume(n) {
	    this._bufferedBytes -= n;

	    if (n === this._buffers[0].length) return this._buffers.shift();

	    if (n < this._buffers[0].length) {
	      const buf = this._buffers[0];
	      this._buffers[0] = new FastBuffer(
	        buf.buffer,
	        buf.byteOffset + n,
	        buf.length - n
	      );

	      return new FastBuffer(buf.buffer, buf.byteOffset, n);
	    }

	    const dst = Buffer.allocUnsafe(n);

	    do {
	      const buf = this._buffers[0];
	      const offset = dst.length - n;

	      if (n >= buf.length) {
	        dst.set(this._buffers.shift(), offset);
	      } else {
	        dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
	        this._buffers[0] = new FastBuffer(
	          buf.buffer,
	          buf.byteOffset + n,
	          buf.length - n
	        );
	      }

	      n -= buf.length;
	    } while (n > 0);

	    return dst;
	  }

	  /**
	   * Starts the parsing loop.
	   *
	   * @param {Function} cb Callback
	   * @private
	   */
	  startLoop(cb) {
	    this._loop = true;

	    do {
	      switch (this._state) {
	        case GET_INFO:
	          this.getInfo(cb);
	          break;
	        case GET_PAYLOAD_LENGTH_16:
	          this.getPayloadLength16(cb);
	          break;
	        case GET_PAYLOAD_LENGTH_64:
	          this.getPayloadLength64(cb);
	          break;
	        case GET_MASK:
	          this.getMask();
	          break;
	        case GET_DATA:
	          this.getData(cb);
	          break;
	        case INFLATING:
	        case DEFER_EVENT:
	          this._loop = false;
	          return;
	      }
	    } while (this._loop);

	    if (!this._errored) cb();
	  }

	  /**
	   * Reads the first two bytes of a frame.
	   *
	   * @param {Function} cb Callback
	   * @private
	   */
	  getInfo(cb) {
	    if (this._bufferedBytes < 2) {
	      this._loop = false;
	      return;
	    }

	    const buf = this.consume(2);

	    if ((buf[0] & 0x30) !== 0x00) {
	      const error = this.createError(
	        RangeError,
	        'RSV2 and RSV3 must be clear',
	        true,
	        1002,
	        'WS_ERR_UNEXPECTED_RSV_2_3'
	      );

	      cb(error);
	      return;
	    }

	    const compressed = (buf[0] & 0x40) === 0x40;

	    if (compressed && !this._extensions[PerMessageDeflate.extensionName]) {
	      const error = this.createError(
	        RangeError,
	        'RSV1 must be clear',
	        true,
	        1002,
	        'WS_ERR_UNEXPECTED_RSV_1'
	      );

	      cb(error);
	      return;
	    }

	    this._fin = (buf[0] & 0x80) === 0x80;
	    this._opcode = buf[0] & 0x0f;
	    this._payloadLength = buf[1] & 0x7f;

	    if (this._opcode === 0x00) {
	      if (compressed) {
	        const error = this.createError(
	          RangeError,
	          'RSV1 must be clear',
	          true,
	          1002,
	          'WS_ERR_UNEXPECTED_RSV_1'
	        );

	        cb(error);
	        return;
	      }

	      if (!this._fragmented) {
	        const error = this.createError(
	          RangeError,
	          'invalid opcode 0',
	          true,
	          1002,
	          'WS_ERR_INVALID_OPCODE'
	        );

	        cb(error);
	        return;
	      }

	      this._opcode = this._fragmented;
	    } else if (this._opcode === 0x01 || this._opcode === 0x02) {
	      if (this._fragmented) {
	        const error = this.createError(
	          RangeError,
	          `invalid opcode ${this._opcode}`,
	          true,
	          1002,
	          'WS_ERR_INVALID_OPCODE'
	        );

	        cb(error);
	        return;
	      }

	      this._compressed = compressed;
	    } else if (this._opcode > 0x07 && this._opcode < 0x0b) {
	      if (!this._fin) {
	        const error = this.createError(
	          RangeError,
	          'FIN must be set',
	          true,
	          1002,
	          'WS_ERR_EXPECTED_FIN'
	        );

	        cb(error);
	        return;
	      }

	      if (compressed) {
	        const error = this.createError(
	          RangeError,
	          'RSV1 must be clear',
	          true,
	          1002,
	          'WS_ERR_UNEXPECTED_RSV_1'
	        );

	        cb(error);
	        return;
	      }

	      if (
	        this._payloadLength > 0x7d ||
	        (this._opcode === 0x08 && this._payloadLength === 1)
	      ) {
	        const error = this.createError(
	          RangeError,
	          `invalid payload length ${this._payloadLength}`,
	          true,
	          1002,
	          'WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH'
	        );

	        cb(error);
	        return;
	      }
	    } else {
	      const error = this.createError(
	        RangeError,
	        `invalid opcode ${this._opcode}`,
	        true,
	        1002,
	        'WS_ERR_INVALID_OPCODE'
	      );

	      cb(error);
	      return;
	    }

	    if (!this._fin && !this._fragmented) this._fragmented = this._opcode;
	    this._masked = (buf[1] & 0x80) === 0x80;

	    if (this._isServer) {
	      if (!this._masked) {
	        const error = this.createError(
	          RangeError,
	          'MASK must be set',
	          true,
	          1002,
	          'WS_ERR_EXPECTED_MASK'
	        );

	        cb(error);
	        return;
	      }
	    } else if (this._masked) {
	      const error = this.createError(
	        RangeError,
	        'MASK must be clear',
	        true,
	        1002,
	        'WS_ERR_UNEXPECTED_MASK'
	      );

	      cb(error);
	      return;
	    }

	    if (this._payloadLength === 126) this._state = GET_PAYLOAD_LENGTH_16;
	    else if (this._payloadLength === 127) this._state = GET_PAYLOAD_LENGTH_64;
	    else this.haveLength(cb);
	  }

	  /**
	   * Gets extended payload length (7+16).
	   *
	   * @param {Function} cb Callback
	   * @private
	   */
	  getPayloadLength16(cb) {
	    if (this._bufferedBytes < 2) {
	      this._loop = false;
	      return;
	    }

	    this._payloadLength = this.consume(2).readUInt16BE(0);
	    this.haveLength(cb);
	  }

	  /**
	   * Gets extended payload length (7+64).
	   *
	   * @param {Function} cb Callback
	   * @private
	   */
	  getPayloadLength64(cb) {
	    if (this._bufferedBytes < 8) {
	      this._loop = false;
	      return;
	    }

	    const buf = this.consume(8);
	    const num = buf.readUInt32BE(0);

	    //
	    // The maximum safe integer in JavaScript is 2^53 - 1. An error is returned
	    // if payload length is greater than this number.
	    //
	    if (num > Math.pow(2, 53 - 32) - 1) {
	      const error = this.createError(
	        RangeError,
	        'Unsupported WebSocket frame: payload length > 2^53 - 1',
	        false,
	        1009,
	        'WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH'
	      );

	      cb(error);
	      return;
	    }

	    this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
	    this.haveLength(cb);
	  }

	  /**
	   * Payload length has been read.
	   *
	   * @param {Function} cb Callback
	   * @private
	   */
	  haveLength(cb) {
	    if (this._payloadLength && this._opcode < 0x08) {
	      this._totalPayloadLength += this._payloadLength;
	      if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
	        const error = this.createError(
	          RangeError,
	          'Max payload size exceeded',
	          false,
	          1009,
	          'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'
	        );

	        cb(error);
	        return;
	      }
	    }

	    if (this._masked) this._state = GET_MASK;
	    else this._state = GET_DATA;
	  }

	  /**
	   * Reads mask bytes.
	   *
	   * @private
	   */
	  getMask() {
	    if (this._bufferedBytes < 4) {
	      this._loop = false;
	      return;
	    }

	    this._mask = this.consume(4);
	    this._state = GET_DATA;
	  }

	  /**
	   * Reads data bytes.
	   *
	   * @param {Function} cb Callback
	   * @private
	   */
	  getData(cb) {
	    let data = EMPTY_BUFFER;

	    if (this._payloadLength) {
	      if (this._bufferedBytes < this._payloadLength) {
	        this._loop = false;
	        return;
	      }

	      data = this.consume(this._payloadLength);

	      if (
	        this._masked &&
	        (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0
	      ) {
	        unmask(data, this._mask);
	      }
	    }

	    if (this._opcode > 0x07) {
	      this.controlMessage(data, cb);
	      return;
	    }

	    if (this._maxFragments > 0 && ++this._numFragments > this._maxFragments) {
	      const error = this.createError(
	        RangeError,
	        'Too many message fragments',
	        false,
	        1008,
	        'WS_ERR_TOO_MANY_BUFFERED_PARTS'
	      );

	      cb(error);
	      return;
	    }

	    if (this._compressed) {
	      this._state = INFLATING;
	      this.decompress(data, cb);
	      return;
	    }

	    if (data.length) {
	      //
	      // This message is not compressed so its length is the sum of the payload
	      // length of all fragments.
	      //
	      this._messageLength = this._totalPayloadLength;
	      this._fragments.push(data);
	    }

	    this.dataMessage(cb);
	  }

	  /**
	   * Decompresses data.
	   *
	   * @param {Buffer} data Compressed data
	   * @param {Function} cb Callback
	   * @private
	   */
	  decompress(data, cb) {
	    const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];

	    perMessageDeflate.decompress(data, this._fin, (err, buf) => {
	      if (err) return cb(err);

	      if (buf.length) {
	        this._messageLength += buf.length;
	        if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
	          const error = this.createError(
	            RangeError,
	            'Max payload size exceeded',
	            false,
	            1009,
	            'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'
	          );

	          cb(error);
	          return;
	        }

	        this._fragments.push(buf);
	      }

	      this.dataMessage(cb);
	      if (this._state === GET_INFO) this.startLoop(cb);
	    });
	  }

	  /**
	   * Handles a data message.
	   *
	   * @param {Function} cb Callback
	   * @private
	   */
	  dataMessage(cb) {
	    if (!this._fin) {
	      this._state = GET_INFO;
	      return;
	    }

	    const messageLength = this._messageLength;
	    const fragments = this._fragments;

	    this._totalPayloadLength = 0;
	    this._messageLength = 0;
	    this._fragmented = 0;
	    this._numFragments = 0;
	    this._fragments = [];

	    if (this._opcode === 2) {
	      let data;

	      if (this._binaryType === 'nodebuffer') {
	        data = concat(fragments, messageLength);
	      } else if (this._binaryType === 'arraybuffer') {
	        data = toArrayBuffer(concat(fragments, messageLength));
	      } else if (this._binaryType === 'blob') {
	        data = new Blob(fragments);
	      } else {
	        data = fragments;
	      }

	      if (this._allowSynchronousEvents) {
	        this.emit('message', data, true);
	        this._state = GET_INFO;
	      } else {
	        this._state = DEFER_EVENT;
	        setImmediate(() => {
	          this.emit('message', data, true);
	          this._state = GET_INFO;
	          this.startLoop(cb);
	        });
	      }
	    } else {
	      const buf = concat(fragments, messageLength);

	      if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
	        const error = this.createError(
	          Error,
	          'invalid UTF-8 sequence',
	          true,
	          1007,
	          'WS_ERR_INVALID_UTF8'
	        );

	        cb(error);
	        return;
	      }

	      if (this._state === INFLATING || this._allowSynchronousEvents) {
	        this.emit('message', buf, false);
	        this._state = GET_INFO;
	      } else {
	        this._state = DEFER_EVENT;
	        setImmediate(() => {
	          this.emit('message', buf, false);
	          this._state = GET_INFO;
	          this.startLoop(cb);
	        });
	      }
	    }
	  }

	  /**
	   * Handles a control message.
	   *
	   * @param {Buffer} data Data to handle
	   * @return {(Error|RangeError|undefined)} A possible error
	   * @private
	   */
	  controlMessage(data, cb) {
	    if (this._opcode === 0x08) {
	      if (data.length === 0) {
	        this._loop = false;
	        this.emit('conclude', 1005, EMPTY_BUFFER);
	        this.end();
	      } else {
	        const code = data.readUInt16BE(0);

	        if (!isValidStatusCode(code)) {
	          const error = this.createError(
	            RangeError,
	            `invalid status code ${code}`,
	            true,
	            1002,
	            'WS_ERR_INVALID_CLOSE_CODE'
	          );

	          cb(error);
	          return;
	        }

	        const buf = new FastBuffer(
	          data.buffer,
	          data.byteOffset + 2,
	          data.length - 2
	        );

	        if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
	          const error = this.createError(
	            Error,
	            'invalid UTF-8 sequence',
	            true,
	            1007,
	            'WS_ERR_INVALID_UTF8'
	          );

	          cb(error);
	          return;
	        }

	        this._loop = false;
	        this.emit('conclude', code, buf);
	        this.end();
	      }

	      this._state = GET_INFO;
	      return;
	    }

	    if (this._allowSynchronousEvents) {
	      this.emit(this._opcode === 0x09 ? 'ping' : 'pong', data);
	      this._state = GET_INFO;
	    } else {
	      this._state = DEFER_EVENT;
	      setImmediate(() => {
	        this.emit(this._opcode === 0x09 ? 'ping' : 'pong', data);
	        this._state = GET_INFO;
	        this.startLoop(cb);
	      });
	    }
	  }

	  /**
	   * Builds an error object.
	   *
	   * @param {function(new:Error|RangeError)} ErrorCtor The error constructor
	   * @param {String} message The error message
	   * @param {Boolean} prefix Specifies whether or not to add a default prefix to
	   *     `message`
	   * @param {Number} statusCode The status code
	   * @param {String} errorCode The exposed error code
	   * @return {(Error|RangeError)} The error
	   * @private
	   */
	  createError(ErrorCtor, message, prefix, statusCode, errorCode) {
	    this._loop = false;
	    this._errored = true;

	    const err = new ErrorCtor(
	      prefix ? `Invalid WebSocket frame: ${message}` : message
	    );

	    Error.captureStackTrace(err, this.createError);
	    err.code = errorCode;
	    err[kStatusCode] = statusCode;
	    return err;
	  }
	}

	receiver = Receiver;
	return receiver;
}

/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "^Duplex" }] */

var sender;
var hasRequiredSender;

function requireSender () {
	if (hasRequiredSender) return sender;
	hasRequiredSender = 1;

	const { Duplex } = require$$0$2;
	const { randomFillSync } = require$$1;
	const {
	  types: { isUint8Array }
	} = require$$2;

	const PerMessageDeflate = requirePermessageDeflate();
	const { EMPTY_BUFFER, kWebSocket, NOOP } = requireConstants();
	const { isBlob, isValidStatusCode } = requireValidation();
	const { mask: applyMask, toBuffer } = requireBufferUtil();

	const kByteLength = Symbol('kByteLength');
	const maskBuffer = Buffer.alloc(4);
	const RANDOM_POOL_SIZE = 8 * 1024;
	let randomPool;
	let randomPoolPointer = RANDOM_POOL_SIZE;

	const DEFAULT = 0;
	const DEFLATING = 1;
	const GET_BLOB_DATA = 2;

	/**
	 * HyBi Sender implementation.
	 */
	class Sender {
	  /**
	   * Creates a Sender instance.
	   *
	   * @param {Duplex} socket The connection socket
	   * @param {Object} [extensions] An object containing the negotiated extensions
	   * @param {Function} [generateMask] The function used to generate the masking
	   *     key
	   */
	  constructor(socket, extensions, generateMask) {
	    this._extensions = extensions || {};

	    if (generateMask) {
	      this._generateMask = generateMask;
	      this._maskBuffer = Buffer.alloc(4);
	    }

	    this._socket = socket;

	    this._firstFragment = true;
	    this._compress = false;

	    this._bufferedBytes = 0;
	    this._queue = [];
	    this._state = DEFAULT;
	    this.onerror = NOOP;
	    this[kWebSocket] = undefined;
	  }

	  /**
	   * Frames a piece of data according to the HyBi WebSocket protocol.
	   *
	   * @param {(Buffer|String)} data The data to frame
	   * @param {Object} options Options object
	   * @param {Boolean} [options.fin=false] Specifies whether or not to set the
	   *     FIN bit
	   * @param {Function} [options.generateMask] The function used to generate the
	   *     masking key
	   * @param {Boolean} [options.mask=false] Specifies whether or not to mask
	   *     `data`
	   * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
	   *     key
	   * @param {Number} options.opcode The opcode
	   * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
	   *     modified
	   * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
	   *     RSV1 bit
	   * @return {(Buffer|String)[]} The framed data
	   * @public
	   */
	  static frame(data, options) {
	    let mask;
	    let merge = false;
	    let offset = 2;
	    let skipMasking = false;

	    if (options.mask) {
	      mask = options.maskBuffer || maskBuffer;

	      if (options.generateMask) {
	        options.generateMask(mask);
	      } else {
	        if (randomPoolPointer === RANDOM_POOL_SIZE) {
	          /* istanbul ignore else  */
	          if (randomPool === undefined) {
	            //
	            // This is lazily initialized because server-sent frames must not
	            // be masked so it may never be used.
	            //
	            randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
	          }

	          randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
	          randomPoolPointer = 0;
	        }

	        mask[0] = randomPool[randomPoolPointer++];
	        mask[1] = randomPool[randomPoolPointer++];
	        mask[2] = randomPool[randomPoolPointer++];
	        mask[3] = randomPool[randomPoolPointer++];
	      }

	      skipMasking = (mask[0] | mask[1] | mask[2] | mask[3]) === 0;
	      offset = 6;
	    }

	    let dataLength;

	    if (typeof data === 'string') {
	      if (
	        (!options.mask || skipMasking) &&
	        options[kByteLength] !== undefined
	      ) {
	        dataLength = options[kByteLength];
	      } else {
	        data = Buffer.from(data);
	        dataLength = data.length;
	      }
	    } else {
	      dataLength = data.length;
	      merge = options.mask && options.readOnly && !skipMasking;
	    }

	    let payloadLength = dataLength;

	    if (dataLength >= 65536) {
	      offset += 8;
	      payloadLength = 127;
	    } else if (dataLength > 125) {
	      offset += 2;
	      payloadLength = 126;
	    }

	    const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);

	    target[0] = options.fin ? options.opcode | 0x80 : options.opcode;
	    if (options.rsv1) target[0] |= 0x40;

	    target[1] = payloadLength;

	    if (payloadLength === 126) {
	      target.writeUInt16BE(dataLength, 2);
	    } else if (payloadLength === 127) {
	      target[2] = target[3] = 0;
	      target.writeUIntBE(dataLength, 4, 6);
	    }

	    if (!options.mask) return [target, data];

	    target[1] |= 0x80;
	    target[offset - 4] = mask[0];
	    target[offset - 3] = mask[1];
	    target[offset - 2] = mask[2];
	    target[offset - 1] = mask[3];

	    if (skipMasking) return [target, data];

	    if (merge) {
	      applyMask(data, mask, target, offset, dataLength);
	      return [target];
	    }

	    applyMask(data, mask, data, 0, dataLength);
	    return [target, data];
	  }

	  /**
	   * Sends a close message to the other peer.
	   *
	   * @param {Number} [code] The status code component of the body
	   * @param {(String|Buffer)} [data] The message component of the body
	   * @param {Boolean} [mask=false] Specifies whether or not to mask the message
	   * @param {Function} [cb] Callback
	   * @public
	   */
	  close(code, data, mask, cb) {
	    let buf;

	    if (code === undefined) {
	      buf = EMPTY_BUFFER;
	    } else if (typeof code !== 'number' || !isValidStatusCode(code)) {
	      throw new TypeError('First argument must be a valid error code number');
	    } else if (data === undefined || !data.length) {
	      buf = Buffer.allocUnsafe(2);
	      buf.writeUInt16BE(code, 0);
	    } else {
	      const length = Buffer.byteLength(data);

	      if (length > 123) {
	        throw new RangeError('The message must not be greater than 123 bytes');
	      }

	      buf = Buffer.allocUnsafe(2 + length);
	      buf.writeUInt16BE(code, 0);

	      if (typeof data === 'string') {
	        buf.write(data, 2);
	      } else if (isUint8Array(data)) {
	        buf.set(data, 2);
	      } else {
	        throw new TypeError('Second argument must be a string or a Uint8Array');
	      }
	    }

	    const options = {
	      [kByteLength]: buf.length,
	      fin: true,
	      generateMask: this._generateMask,
	      mask,
	      maskBuffer: this._maskBuffer,
	      opcode: 0x08,
	      readOnly: false,
	      rsv1: false
	    };

	    if (this._state !== DEFAULT) {
	      this.enqueue([this.dispatch, buf, false, options, cb]);
	    } else {
	      this.sendFrame(Sender.frame(buf, options), cb);
	    }
	  }

	  /**
	   * Sends a ping message to the other peer.
	   *
	   * @param {*} data The message to send
	   * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
	   * @param {Function} [cb] Callback
	   * @public
	   */
	  ping(data, mask, cb) {
	    let byteLength;
	    let readOnly;

	    if (typeof data === 'string') {
	      byteLength = Buffer.byteLength(data);
	      readOnly = false;
	    } else if (isBlob(data)) {
	      byteLength = data.size;
	      readOnly = false;
	    } else {
	      data = toBuffer(data);
	      byteLength = data.length;
	      readOnly = toBuffer.readOnly;
	    }

	    if (byteLength > 125) {
	      throw new RangeError('The data size must not be greater than 125 bytes');
	    }

	    const options = {
	      [kByteLength]: byteLength,
	      fin: true,
	      generateMask: this._generateMask,
	      mask,
	      maskBuffer: this._maskBuffer,
	      opcode: 0x09,
	      readOnly,
	      rsv1: false
	    };

	    if (isBlob(data)) {
	      if (this._state !== DEFAULT) {
	        this.enqueue([this.getBlobData, data, false, options, cb]);
	      } else {
	        this.getBlobData(data, false, options, cb);
	      }
	    } else if (this._state !== DEFAULT) {
	      this.enqueue([this.dispatch, data, false, options, cb]);
	    } else {
	      this.sendFrame(Sender.frame(data, options), cb);
	    }
	  }

	  /**
	   * Sends a pong message to the other peer.
	   *
	   * @param {*} data The message to send
	   * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
	   * @param {Function} [cb] Callback
	   * @public
	   */
	  pong(data, mask, cb) {
	    let byteLength;
	    let readOnly;

	    if (typeof data === 'string') {
	      byteLength = Buffer.byteLength(data);
	      readOnly = false;
	    } else if (isBlob(data)) {
	      byteLength = data.size;
	      readOnly = false;
	    } else {
	      data = toBuffer(data);
	      byteLength = data.length;
	      readOnly = toBuffer.readOnly;
	    }

	    if (byteLength > 125) {
	      throw new RangeError('The data size must not be greater than 125 bytes');
	    }

	    const options = {
	      [kByteLength]: byteLength,
	      fin: true,
	      generateMask: this._generateMask,
	      mask,
	      maskBuffer: this._maskBuffer,
	      opcode: 0x0a,
	      readOnly,
	      rsv1: false
	    };

	    if (isBlob(data)) {
	      if (this._state !== DEFAULT) {
	        this.enqueue([this.getBlobData, data, false, options, cb]);
	      } else {
	        this.getBlobData(data, false, options, cb);
	      }
	    } else if (this._state !== DEFAULT) {
	      this.enqueue([this.dispatch, data, false, options, cb]);
	    } else {
	      this.sendFrame(Sender.frame(data, options), cb);
	    }
	  }

	  /**
	   * Sends a data message to the other peer.
	   *
	   * @param {*} data The message to send
	   * @param {Object} options Options object
	   * @param {Boolean} [options.binary=false] Specifies whether `data` is binary
	   *     or text
	   * @param {Boolean} [options.compress=false] Specifies whether or not to
	   *     compress `data`
	   * @param {Boolean} [options.fin=false] Specifies whether the fragment is the
	   *     last one
	   * @param {Boolean} [options.mask=false] Specifies whether or not to mask
	   *     `data`
	   * @param {Function} [cb] Callback
	   * @public
	   */
	  send(data, options, cb) {
	    const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
	    let opcode = options.binary ? 2 : 1;
	    let rsv1 = options.compress;

	    let byteLength;
	    let readOnly;

	    if (typeof data === 'string') {
	      byteLength = Buffer.byteLength(data);
	      readOnly = false;
	    } else if (isBlob(data)) {
	      byteLength = data.size;
	      readOnly = false;
	    } else {
	      data = toBuffer(data);
	      byteLength = data.length;
	      readOnly = toBuffer.readOnly;
	    }

	    if (this._firstFragment) {
	      this._firstFragment = false;
	      if (
	        rsv1 &&
	        perMessageDeflate &&
	        perMessageDeflate.params[
	          perMessageDeflate._isServer
	            ? 'server_no_context_takeover'
	            : 'client_no_context_takeover'
	        ]
	      ) {
	        rsv1 = byteLength >= perMessageDeflate._threshold;
	      }
	      this._compress = rsv1;
	    } else {
	      rsv1 = false;
	      opcode = 0;
	    }

	    if (options.fin) this._firstFragment = true;

	    const opts = {
	      [kByteLength]: byteLength,
	      fin: options.fin,
	      generateMask: this._generateMask,
	      mask: options.mask,
	      maskBuffer: this._maskBuffer,
	      opcode,
	      readOnly,
	      rsv1
	    };

	    if (isBlob(data)) {
	      if (this._state !== DEFAULT) {
	        this.enqueue([this.getBlobData, data, this._compress, opts, cb]);
	      } else {
	        this.getBlobData(data, this._compress, opts, cb);
	      }
	    } else if (this._state !== DEFAULT) {
	      this.enqueue([this.dispatch, data, this._compress, opts, cb]);
	    } else {
	      this.dispatch(data, this._compress, opts, cb);
	    }
	  }

	  /**
	   * Gets the contents of a blob as binary data.
	   *
	   * @param {Blob} blob The blob
	   * @param {Boolean} [compress=false] Specifies whether or not to compress
	   *     the data
	   * @param {Object} options Options object
	   * @param {Boolean} [options.fin=false] Specifies whether or not to set the
	   *     FIN bit
	   * @param {Function} [options.generateMask] The function used to generate the
	   *     masking key
	   * @param {Boolean} [options.mask=false] Specifies whether or not to mask
	   *     `data`
	   * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
	   *     key
	   * @param {Number} options.opcode The opcode
	   * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
	   *     modified
	   * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
	   *     RSV1 bit
	   * @param {Function} [cb] Callback
	   * @private
	   */
	  getBlobData(blob, compress, options, cb) {
	    this._bufferedBytes += options[kByteLength];
	    this._state = GET_BLOB_DATA;

	    blob
	      .arrayBuffer()
	      .then((arrayBuffer) => {
	        if (this._socket.destroyed) {
	          const err = new Error(
	            'The socket was closed while the blob was being read'
	          );

	          //
	          // `callCallbacks` is called in the next tick to ensure that errors
	          // that might be thrown in the callbacks behave like errors thrown
	          // outside the promise chain.
	          //
	          process.nextTick(callCallbacks, this, err, cb);
	          return;
	        }

	        this._bufferedBytes -= options[kByteLength];
	        const data = toBuffer(arrayBuffer);

	        if (!compress) {
	          this._state = DEFAULT;
	          this.sendFrame(Sender.frame(data, options), cb);
	          this.dequeue();
	        } else {
	          this.dispatch(data, compress, options, cb);
	        }
	      })
	      .catch((err) => {
	        //
	        // `onError` is called in the next tick for the same reason that
	        // `callCallbacks` above is.
	        //
	        process.nextTick(onError, this, err, cb);
	      });
	  }

	  /**
	   * Dispatches a message.
	   *
	   * @param {(Buffer|String)} data The message to send
	   * @param {Boolean} [compress=false] Specifies whether or not to compress
	   *     `data`
	   * @param {Object} options Options object
	   * @param {Boolean} [options.fin=false] Specifies whether or not to set the
	   *     FIN bit
	   * @param {Function} [options.generateMask] The function used to generate the
	   *     masking key
	   * @param {Boolean} [options.mask=false] Specifies whether or not to mask
	   *     `data`
	   * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
	   *     key
	   * @param {Number} options.opcode The opcode
	   * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
	   *     modified
	   * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
	   *     RSV1 bit
	   * @param {Function} [cb] Callback
	   * @private
	   */
	  dispatch(data, compress, options, cb) {
	    if (!compress) {
	      this.sendFrame(Sender.frame(data, options), cb);
	      return;
	    }

	    const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];

	    this._bufferedBytes += options[kByteLength];
	    this._state = DEFLATING;
	    perMessageDeflate.compress(data, options.fin, (_, buf) => {
	      if (this._socket.destroyed) {
	        const err = new Error(
	          'The socket was closed while data was being compressed'
	        );

	        callCallbacks(this, err, cb);
	        return;
	      }

	      this._bufferedBytes -= options[kByteLength];
	      this._state = DEFAULT;
	      options.readOnly = false;
	      this.sendFrame(Sender.frame(buf, options), cb);
	      this.dequeue();
	    });
	  }

	  /**
	   * Executes queued send operations.
	   *
	   * @private
	   */
	  dequeue() {
	    while (this._state === DEFAULT && this._queue.length) {
	      const params = this._queue.shift();

	      this._bufferedBytes -= params[3][kByteLength];
	      Reflect.apply(params[0], this, params.slice(1));
	    }
	  }

	  /**
	   * Enqueues a send operation.
	   *
	   * @param {Array} params Send operation parameters.
	   * @private
	   */
	  enqueue(params) {
	    this._bufferedBytes += params[3][kByteLength];
	    this._queue.push(params);
	  }

	  /**
	   * Sends a frame.
	   *
	   * @param {(Buffer | String)[]} list The frame to send
	   * @param {Function} [cb] Callback
	   * @private
	   */
	  sendFrame(list, cb) {
	    if (list.length === 2) {
	      this._socket.cork();
	      this._socket.write(list[0]);
	      this._socket.write(list[1], cb);
	      this._socket.uncork();
	    } else {
	      this._socket.write(list[0], cb);
	    }
	  }
	}

	sender = Sender;

	/**
	 * Calls queued callbacks with an error.
	 *
	 * @param {Sender} sender The `Sender` instance
	 * @param {Error} err The error to call the callbacks with
	 * @param {Function} [cb] The first callback
	 * @private
	 */
	function callCallbacks(sender, err, cb) {
	  if (typeof cb === 'function') cb(err);

	  for (let i = 0; i < sender._queue.length; i++) {
	    const params = sender._queue[i];
	    const callback = params[params.length - 1];

	    if (typeof callback === 'function') callback(err);
	  }
	}

	/**
	 * Handles a `Sender` error.
	 *
	 * @param {Sender} sender The `Sender` instance
	 * @param {Error} err The error
	 * @param {Function} [cb] The first pending callback
	 * @private
	 */
	function onError(sender, err, cb) {
	  callCallbacks(sender, err, cb);
	  sender.onerror(err);
	}
	return sender;
}

var eventTarget;
var hasRequiredEventTarget;

function requireEventTarget () {
	if (hasRequiredEventTarget) return eventTarget;
	hasRequiredEventTarget = 1;

	const { kForOnEventAttribute, kListener } = requireConstants();

	const kCode = Symbol('kCode');
	const kData = Symbol('kData');
	const kError = Symbol('kError');
	const kMessage = Symbol('kMessage');
	const kReason = Symbol('kReason');
	const kTarget = Symbol('kTarget');
	const kType = Symbol('kType');
	const kWasClean = Symbol('kWasClean');

	/**
	 * Class representing an event.
	 */
	class Event {
	  /**
	   * Create a new `Event`.
	   *
	   * @param {String} type The name of the event
	   * @throws {TypeError} If the `type` argument is not specified
	   */
	  constructor(type) {
	    this[kTarget] = null;
	    this[kType] = type;
	  }

	  /**
	   * @type {*}
	   */
	  get target() {
	    return this[kTarget];
	  }

	  /**
	   * @type {String}
	   */
	  get type() {
	    return this[kType];
	  }
	}

	Object.defineProperty(Event.prototype, 'target', { enumerable: true });
	Object.defineProperty(Event.prototype, 'type', { enumerable: true });

	/**
	 * Class representing a close event.
	 *
	 * @extends Event
	 */
	class CloseEvent extends Event {
	  /**
	   * Create a new `CloseEvent`.
	   *
	   * @param {String} type The name of the event
	   * @param {Object} [options] A dictionary object that allows for setting
	   *     attributes via object members of the same name
	   * @param {Number} [options.code=0] The status code explaining why the
	   *     connection was closed
	   * @param {String} [options.reason=''] A human-readable string explaining why
	   *     the connection was closed
	   * @param {Boolean} [options.wasClean=false] Indicates whether or not the
	   *     connection was cleanly closed
	   */
	  constructor(type, options = {}) {
	    super(type);

	    this[kCode] = options.code === undefined ? 0 : options.code;
	    this[kReason] = options.reason === undefined ? '' : options.reason;
	    this[kWasClean] = options.wasClean === undefined ? false : options.wasClean;
	  }

	  /**
	   * @type {Number}
	   */
	  get code() {
	    return this[kCode];
	  }

	  /**
	   * @type {String}
	   */
	  get reason() {
	    return this[kReason];
	  }

	  /**
	   * @type {Boolean}
	   */
	  get wasClean() {
	    return this[kWasClean];
	  }
	}

	Object.defineProperty(CloseEvent.prototype, 'code', { enumerable: true });
	Object.defineProperty(CloseEvent.prototype, 'reason', { enumerable: true });
	Object.defineProperty(CloseEvent.prototype, 'wasClean', { enumerable: true });

	/**
	 * Class representing an error event.
	 *
	 * @extends Event
	 */
	class ErrorEvent extends Event {
	  /**
	   * Create a new `ErrorEvent`.
	   *
	   * @param {String} type The name of the event
	   * @param {Object} [options] A dictionary object that allows for setting
	   *     attributes via object members of the same name
	   * @param {*} [options.error=null] The error that generated this event
	   * @param {String} [options.message=''] The error message
	   */
	  constructor(type, options = {}) {
	    super(type);

	    this[kError] = options.error === undefined ? null : options.error;
	    this[kMessage] = options.message === undefined ? '' : options.message;
	  }

	  /**
	   * @type {*}
	   */
	  get error() {
	    return this[kError];
	  }

	  /**
	   * @type {String}
	   */
	  get message() {
	    return this[kMessage];
	  }
	}

	Object.defineProperty(ErrorEvent.prototype, 'error', { enumerable: true });
	Object.defineProperty(ErrorEvent.prototype, 'message', { enumerable: true });

	/**
	 * Class representing a message event.
	 *
	 * @extends Event
	 */
	class MessageEvent extends Event {
	  /**
	   * Create a new `MessageEvent`.
	   *
	   * @param {String} type The name of the event
	   * @param {Object} [options] A dictionary object that allows for setting
	   *     attributes via object members of the same name
	   * @param {*} [options.data=null] The message content
	   */
	  constructor(type, options = {}) {
	    super(type);

	    this[kData] = options.data === undefined ? null : options.data;
	  }

	  /**
	   * @type {*}
	   */
	  get data() {
	    return this[kData];
	  }
	}

	Object.defineProperty(MessageEvent.prototype, 'data', { enumerable: true });

	/**
	 * This provides methods for emulating the `EventTarget` interface. It's not
	 * meant to be used directly.
	 *
	 * @mixin
	 */
	const EventTarget = {
	  /**
	   * Register an event listener.
	   *
	   * @param {String} type A string representing the event type to listen for
	   * @param {(Function|Object)} handler The listener to add
	   * @param {Object} [options] An options object specifies characteristics about
	   *     the event listener
	   * @param {Boolean} [options.once=false] A `Boolean` indicating that the
	   *     listener should be invoked at most once after being added. If `true`,
	   *     the listener would be automatically removed when invoked.
	   * @public
	   */
	  addEventListener(type, handler, options = {}) {
	    for (const listener of this.listeners(type)) {
	      if (
	        !options[kForOnEventAttribute] &&
	        listener[kListener] === handler &&
	        !listener[kForOnEventAttribute]
	      ) {
	        return;
	      }
	    }

	    let wrapper;

	    if (type === 'message') {
	      wrapper = function onMessage(data, isBinary) {
	        const event = new MessageEvent('message', {
	          data: isBinary ? data : data.toString()
	        });

	        event[kTarget] = this;
	        callListener(handler, this, event);
	      };
	    } else if (type === 'close') {
	      wrapper = function onClose(code, message) {
	        const event = new CloseEvent('close', {
	          code,
	          reason: message.toString(),
	          wasClean: this._closeFrameReceived && this._closeFrameSent
	        });

	        event[kTarget] = this;
	        callListener(handler, this, event);
	      };
	    } else if (type === 'error') {
	      wrapper = function onError(error) {
	        const event = new ErrorEvent('error', {
	          error,
	          message: error.message
	        });

	        event[kTarget] = this;
	        callListener(handler, this, event);
	      };
	    } else if (type === 'open') {
	      wrapper = function onOpen() {
	        const event = new Event('open');

	        event[kTarget] = this;
	        callListener(handler, this, event);
	      };
	    } else {
	      return;
	    }

	    wrapper[kForOnEventAttribute] = !!options[kForOnEventAttribute];
	    wrapper[kListener] = handler;

	    if (options.once) {
	      this.once(type, wrapper);
	    } else {
	      this.on(type, wrapper);
	    }
	  },

	  /**
	   * Remove an event listener.
	   *
	   * @param {String} type A string representing the event type to remove
	   * @param {(Function|Object)} handler The listener to remove
	   * @public
	   */
	  removeEventListener(type, handler) {
	    for (const listener of this.listeners(type)) {
	      if (listener[kListener] === handler && !listener[kForOnEventAttribute]) {
	        this.removeListener(type, listener);
	        break;
	      }
	    }
	  }
	};

	eventTarget = {
	  CloseEvent,
	  ErrorEvent,
	  Event,
	  EventTarget,
	  MessageEvent
	};

	/**
	 * Call an event listener
	 *
	 * @param {(Function|Object)} listener The listener to call
	 * @param {*} thisArg The value to use as `this`` when calling the listener
	 * @param {Event} event The event to pass to the listener
	 * @private
	 */
	function callListener(listener, thisArg, event) {
	  if (typeof listener === 'object' && listener.handleEvent) {
	    listener.handleEvent.call(listener, event);
	  } else {
	    listener.call(thisArg, event);
	  }
	}
	return eventTarget;
}

var extension;
var hasRequiredExtension;

function requireExtension () {
	if (hasRequiredExtension) return extension;
	hasRequiredExtension = 1;

	const { tokenChars } = requireValidation();

	/**
	 * Adds an offer to the map of extension offers or a parameter to the map of
	 * parameters.
	 *
	 * @param {Object} dest The map of extension offers or parameters
	 * @param {String} name The extension or parameter name
	 * @param {(Object|Boolean|String)} elem The extension parameters or the
	 *     parameter value
	 * @private
	 */
	function push(dest, name, elem) {
	  if (dest[name] === undefined) dest[name] = [elem];
	  else dest[name].push(elem);
	}

	/**
	 * Parses the `Sec-WebSocket-Extensions` header into an object.
	 *
	 * @param {String} header The field value of the header
	 * @return {Object} The parsed object
	 * @public
	 */
	function parse(header) {
	  const offers = Object.create(null);
	  let params = Object.create(null);
	  let mustUnescape = false;
	  let isEscaping = false;
	  let inQuotes = false;
	  let extensionName;
	  let paramName;
	  let start = -1;
	  let code = -1;
	  let end = -1;
	  let i = 0;

	  for (; i < header.length; i++) {
	    code = header.charCodeAt(i);

	    if (extensionName === undefined) {
	      if (end === -1 && tokenChars[code] === 1) {
	        if (start === -1) start = i;
	      } else if (
	        i !== 0 &&
	        (code === 0x20 /* ' ' */ || code === 0x09) /* '\t' */
	      ) {
	        if (end === -1 && start !== -1) end = i;
	      } else if (code === 0x3b /* ';' */ || code === 0x2c /* ',' */) {
	        if (start === -1) {
	          throw new SyntaxError(`Unexpected character at index ${i}`);
	        }

	        if (end === -1) end = i;
	        const name = header.slice(start, end);
	        if (code === 0x2c) {
	          push(offers, name, params);
	          params = Object.create(null);
	        } else {
	          extensionName = name;
	        }

	        start = end = -1;
	      } else {
	        throw new SyntaxError(`Unexpected character at index ${i}`);
	      }
	    } else if (paramName === undefined) {
	      if (end === -1 && tokenChars[code] === 1) {
	        if (start === -1) start = i;
	      } else if (code === 0x20 || code === 0x09) {
	        if (end === -1 && start !== -1) end = i;
	      } else if (code === 0x3b || code === 0x2c) {
	        if (start === -1) {
	          throw new SyntaxError(`Unexpected character at index ${i}`);
	        }

	        if (end === -1) end = i;
	        push(params, header.slice(start, end), true);
	        if (code === 0x2c) {
	          push(offers, extensionName, params);
	          params = Object.create(null);
	          extensionName = undefined;
	        }

	        start = end = -1;
	      } else if (code === 0x3d /* '=' */ && start !== -1 && end === -1) {
	        paramName = header.slice(start, i);
	        start = end = -1;
	      } else {
	        throw new SyntaxError(`Unexpected character at index ${i}`);
	      }
	    } else {
	      //
	      // The value of a quoted-string after unescaping must conform to the
	      // token ABNF, so only token characters are valid.
	      // Ref: https://tools.ietf.org/html/rfc6455#section-9.1
	      //
	      if (isEscaping) {
	        if (tokenChars[code] !== 1) {
	          throw new SyntaxError(`Unexpected character at index ${i}`);
	        }
	        if (start === -1) start = i;
	        else if (!mustUnescape) mustUnescape = true;
	        isEscaping = false;
	      } else if (inQuotes) {
	        if (tokenChars[code] === 1) {
	          if (start === -1) start = i;
	        } else if (code === 0x22 /* '"' */ && start !== -1) {
	          inQuotes = false;
	          end = i;
	        } else if (code === 0x5c /* '\' */) {
	          isEscaping = true;
	        } else {
	          throw new SyntaxError(`Unexpected character at index ${i}`);
	        }
	      } else if (code === 0x22 && header.charCodeAt(i - 1) === 0x3d) {
	        inQuotes = true;
	      } else if (end === -1 && tokenChars[code] === 1) {
	        if (start === -1) start = i;
	      } else if (start !== -1 && (code === 0x20 || code === 0x09)) {
	        if (end === -1) end = i;
	      } else if (code === 0x3b || code === 0x2c) {
	        if (start === -1) {
	          throw new SyntaxError(`Unexpected character at index ${i}`);
	        }

	        if (end === -1) end = i;
	        let value = header.slice(start, end);
	        if (mustUnescape) {
	          value = value.replace(/\\/g, '');
	          mustUnescape = false;
	        }
	        push(params, paramName, value);
	        if (code === 0x2c) {
	          push(offers, extensionName, params);
	          params = Object.create(null);
	          extensionName = undefined;
	        }

	        paramName = undefined;
	        start = end = -1;
	      } else {
	        throw new SyntaxError(`Unexpected character at index ${i}`);
	      }
	    }
	  }

	  if (start === -1 || inQuotes || code === 0x20 || code === 0x09) {
	    throw new SyntaxError('Unexpected end of input');
	  }

	  if (end === -1) end = i;
	  const token = header.slice(start, end);
	  if (extensionName === undefined) {
	    push(offers, token, params);
	  } else {
	    if (paramName === undefined) {
	      push(params, token, true);
	    } else if (mustUnescape) {
	      push(params, paramName, token.replace(/\\/g, ''));
	    } else {
	      push(params, paramName, token);
	    }
	    push(offers, extensionName, params);
	  }

	  return offers;
	}

	/**
	 * Builds the `Sec-WebSocket-Extensions` header field value.
	 *
	 * @param {Object} extensions The map of extensions and parameters to format
	 * @return {String} A string representing the given object
	 * @public
	 */
	function format(extensions) {
	  return Object.keys(extensions)
	    .map((extension) => {
	      let configurations = extensions[extension];
	      if (!Array.isArray(configurations)) configurations = [configurations];
	      return configurations
	        .map((params) => {
	          return [extension]
	            .concat(
	              Object.keys(params).map((k) => {
	                let values = params[k];
	                if (!Array.isArray(values)) values = [values];
	                return values
	                  .map((v) => (v === true ? k : `${k}=${v}`))
	                  .join('; ');
	              })
	            )
	            .join('; ');
	        })
	        .join(', ');
	    })
	    .join(', ');
	}

	extension = { format, parse };
	return extension;
}

/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "^Duplex|Readable$", "caughtErrors": "none" }] */

var websocket;
var hasRequiredWebsocket;

function requireWebsocket () {
	if (hasRequiredWebsocket) return websocket;
	hasRequiredWebsocket = 1;

	const EventEmitter = require$$0$3;
	const https = require$$1$1;
	const http = require$$2$1;
	const net = require$$3;
	const tls = require$$4;
	const { randomBytes, createHash } = require$$1;
	const { Duplex, Readable } = require$$0$2;
	const { URL } = require$$7;

	const PerMessageDeflate = requirePermessageDeflate();
	const Receiver = requireReceiver();
	const Sender = requireSender();
	const { isBlob } = requireValidation();

	const {
	  BINARY_TYPES,
	  CLOSE_TIMEOUT,
	  EMPTY_BUFFER,
	  GUID,
	  kForOnEventAttribute,
	  kListener,
	  kStatusCode,
	  kWebSocket,
	  NOOP
	} = requireConstants();
	const {
	  EventTarget: { addEventListener, removeEventListener }
	} = requireEventTarget();
	const { format, parse } = requireExtension();
	const { toBuffer } = requireBufferUtil();

	const kAborted = Symbol('kAborted');
	const protocolVersions = [8, 13];
	const readyStates = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
	const subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;

	/**
	 * Class representing a WebSocket.
	 *
	 * @extends EventEmitter
	 */
	class WebSocket extends EventEmitter {
	  /**
	   * Create a new `WebSocket`.
	   *
	   * @param {(String|URL)} address The URL to which to connect
	   * @param {(String|String[])} [protocols] The subprotocols
	   * @param {Object} [options] Connection options
	   */
	  constructor(address, protocols, options) {
	    super();

	    this._binaryType = BINARY_TYPES[0];
	    this._closeCode = 1006;
	    this._closeFrameReceived = false;
	    this._closeFrameSent = false;
	    this._closeMessage = EMPTY_BUFFER;
	    this._closeTimer = null;
	    this._errorEmitted = false;
	    this._extensions = {};
	    this._paused = false;
	    this._protocol = '';
	    this._readyState = WebSocket.CONNECTING;
	    this._receiver = null;
	    this._sender = null;
	    this._socket = null;

	    if (address !== null) {
	      this._bufferedAmount = 0;
	      this._isServer = false;
	      this._redirects = 0;

	      if (protocols === undefined) {
	        protocols = [];
	      } else if (!Array.isArray(protocols)) {
	        if (typeof protocols === 'object' && protocols !== null) {
	          options = protocols;
	          protocols = [];
	        } else {
	          protocols = [protocols];
	        }
	      }

	      initAsClient(this, address, protocols, options);
	    } else {
	      this._autoPong = options.autoPong;
	      this._closeTimeout = options.closeTimeout;
	      this._isServer = true;
	    }
	  }

	  /**
	   * For historical reasons, the custom "nodebuffer" type is used by the default
	   * instead of "blob".
	   *
	   * @type {String}
	   */
	  get binaryType() {
	    return this._binaryType;
	  }

	  set binaryType(type) {
	    if (!BINARY_TYPES.includes(type)) return;

	    this._binaryType = type;

	    //
	    // Allow to change `binaryType` on the fly.
	    //
	    if (this._receiver) this._receiver._binaryType = type;
	  }

	  /**
	   * @type {Number}
	   */
	  get bufferedAmount() {
	    if (!this._socket) return this._bufferedAmount;

	    return this._socket._writableState.length + this._sender._bufferedBytes;
	  }

	  /**
	   * @type {String}
	   */
	  get extensions() {
	    return Object.keys(this._extensions).join();
	  }

	  /**
	   * @type {Boolean}
	   */
	  get isPaused() {
	    return this._paused;
	  }

	  /**
	   * @type {Function}
	   */
	  /* istanbul ignore next */
	  get onclose() {
	    return null;
	  }

	  /**
	   * @type {Function}
	   */
	  /* istanbul ignore next */
	  get onerror() {
	    return null;
	  }

	  /**
	   * @type {Function}
	   */
	  /* istanbul ignore next */
	  get onopen() {
	    return null;
	  }

	  /**
	   * @type {Function}
	   */
	  /* istanbul ignore next */
	  get onmessage() {
	    return null;
	  }

	  /**
	   * @type {String}
	   */
	  get protocol() {
	    return this._protocol;
	  }

	  /**
	   * @type {Number}
	   */
	  get readyState() {
	    return this._readyState;
	  }

	  /**
	   * @type {String}
	   */
	  get url() {
	    return this._url;
	  }

	  /**
	   * Set up the socket and the internal resources.
	   *
	   * @param {Duplex} socket The network socket between the server and client
	   * @param {Buffer} head The first packet of the upgraded stream
	   * @param {Object} options Options object
	   * @param {Boolean} [options.allowSynchronousEvents=false] Specifies whether
	   *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
	   *     multiple times in the same tick
	   * @param {Function} [options.generateMask] The function used to generate the
	   *     masking key
	   * @param {Number} [options.maxBufferedChunks=0] The maximum number of
	   *     buffered data chunks
	   * @param {Number} [options.maxFragments=0] The maximum number of message
	   *     fragments
	   * @param {Number} [options.maxPayload=0] The maximum allowed message size
	   * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
	   *     not to skip UTF-8 validation for text and close messages
	   * @private
	   */
	  setSocket(socket, head, options) {
	    const receiver = new Receiver({
	      allowSynchronousEvents: options.allowSynchronousEvents,
	      binaryType: this.binaryType,
	      extensions: this._extensions,
	      isServer: this._isServer,
	      maxBufferedChunks: options.maxBufferedChunks,
	      maxFragments: options.maxFragments,
	      maxPayload: options.maxPayload,
	      skipUTF8Validation: options.skipUTF8Validation
	    });

	    const sender = new Sender(socket, this._extensions, options.generateMask);

	    this._receiver = receiver;
	    this._sender = sender;
	    this._socket = socket;

	    receiver[kWebSocket] = this;
	    sender[kWebSocket] = this;
	    socket[kWebSocket] = this;

	    receiver.on('conclude', receiverOnConclude);
	    receiver.on('drain', receiverOnDrain);
	    receiver.on('error', receiverOnError);
	    receiver.on('message', receiverOnMessage);
	    receiver.on('ping', receiverOnPing);
	    receiver.on('pong', receiverOnPong);

	    sender.onerror = senderOnError;

	    //
	    // These methods may not be available if `socket` is just a `Duplex`.
	    //
	    if (socket.setTimeout) socket.setTimeout(0);
	    if (socket.setNoDelay) socket.setNoDelay();

	    if (head.length > 0) socket.unshift(head);

	    socket.on('close', socketOnClose);
	    socket.on('data', socketOnData);
	    socket.on('end', socketOnEnd);
	    socket.on('error', socketOnError);

	    this._readyState = WebSocket.OPEN;
	    this.emit('open');
	  }

	  /**
	   * Emit the `'close'` event.
	   *
	   * @private
	   */
	  emitClose() {
	    if (!this._socket) {
	      this._readyState = WebSocket.CLOSED;
	      this.emit('close', this._closeCode, this._closeMessage);
	      return;
	    }

	    if (this._extensions[PerMessageDeflate.extensionName]) {
	      this._extensions[PerMessageDeflate.extensionName].cleanup();
	    }

	    this._receiver.removeAllListeners();
	    this._readyState = WebSocket.CLOSED;
	    this.emit('close', this._closeCode, this._closeMessage);
	  }

	  /**
	   * Start a closing handshake.
	   *
	   *          +----------+   +-----------+   +----------+
	   *     - - -|ws.close()|-->|close frame|-->|ws.close()|- - -
	   *    |     +----------+   +-----------+   +----------+     |
	   *          +----------+   +-----------+         |
	   * CLOSING  |ws.close()|<--|close frame|<--+-----+       CLOSING
	   *          +----------+   +-----------+   |
	   *    |           |                        |   +---+        |
	   *                +------------------------+-->|fin| - - - -
	   *    |         +---+                      |   +---+
	   *     - - - - -|fin|<---------------------+
	   *              +---+
	   *
	   * @param {Number} [code] Status code explaining why the connection is closing
	   * @param {(String|Buffer)} [data] The reason why the connection is
	   *     closing
	   * @public
	   */
	  close(code, data) {
	    if (this.readyState === WebSocket.CLOSED) return;
	    if (this.readyState === WebSocket.CONNECTING) {
	      const msg = 'WebSocket was closed before the connection was established';
	      abortHandshake(this, this._req, msg);
	      return;
	    }

	    if (this.readyState === WebSocket.CLOSING) {
	      if (
	        this._closeFrameSent &&
	        (this._closeFrameReceived || this._receiver._writableState.errorEmitted)
	      ) {
	        this._socket.end();
	      }

	      return;
	    }

	    this._readyState = WebSocket.CLOSING;
	    this._sender.close(code, data, !this._isServer, (err) => {
	      //
	      // This error is handled by the `'error'` listener on the socket. We only
	      // want to know if the close frame has been sent here.
	      //
	      if (err) return;

	      this._closeFrameSent = true;

	      if (
	        this._closeFrameReceived ||
	        this._receiver._writableState.errorEmitted
	      ) {
	        this._socket.end();
	      }
	    });

	    setCloseTimer(this);
	  }

	  /**
	   * Pause the socket.
	   *
	   * @public
	   */
	  pause() {
	    if (
	      this.readyState === WebSocket.CONNECTING ||
	      this.readyState === WebSocket.CLOSED
	    ) {
	      return;
	    }

	    this._paused = true;
	    this._socket.pause();
	  }

	  /**
	   * Send a ping.
	   *
	   * @param {*} [data] The data to send
	   * @param {Boolean} [mask] Indicates whether or not to mask `data`
	   * @param {Function} [cb] Callback which is executed when the ping is sent
	   * @public
	   */
	  ping(data, mask, cb) {
	    if (this.readyState === WebSocket.CONNECTING) {
	      throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
	    }

	    if (typeof data === 'function') {
	      cb = data;
	      data = mask = undefined;
	    } else if (typeof mask === 'function') {
	      cb = mask;
	      mask = undefined;
	    }

	    if (typeof data === 'number') data = data.toString();

	    if (this.readyState !== WebSocket.OPEN) {
	      sendAfterClose(this, data, cb);
	      return;
	    }

	    if (mask === undefined) mask = !this._isServer;
	    this._sender.ping(data || EMPTY_BUFFER, mask, cb);
	  }

	  /**
	   * Send a pong.
	   *
	   * @param {*} [data] The data to send
	   * @param {Boolean} [mask] Indicates whether or not to mask `data`
	   * @param {Function} [cb] Callback which is executed when the pong is sent
	   * @public
	   */
	  pong(data, mask, cb) {
	    if (this.readyState === WebSocket.CONNECTING) {
	      throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
	    }

	    if (typeof data === 'function') {
	      cb = data;
	      data = mask = undefined;
	    } else if (typeof mask === 'function') {
	      cb = mask;
	      mask = undefined;
	    }

	    if (typeof data === 'number') data = data.toString();

	    if (this.readyState !== WebSocket.OPEN) {
	      sendAfterClose(this, data, cb);
	      return;
	    }

	    if (mask === undefined) mask = !this._isServer;
	    this._sender.pong(data || EMPTY_BUFFER, mask, cb);
	  }

	  /**
	   * Resume the socket.
	   *
	   * @public
	   */
	  resume() {
	    if (
	      this.readyState === WebSocket.CONNECTING ||
	      this.readyState === WebSocket.CLOSED
	    ) {
	      return;
	    }

	    this._paused = false;
	    if (!this._receiver._writableState.needDrain) this._socket.resume();
	  }

	  /**
	   * Send a data message.
	   *
	   * @param {*} data The message to send
	   * @param {Object} [options] Options object
	   * @param {Boolean} [options.binary] Specifies whether `data` is binary or
	   *     text
	   * @param {Boolean} [options.compress] Specifies whether or not to compress
	   *     `data`
	   * @param {Boolean} [options.fin=true] Specifies whether the fragment is the
	   *     last one
	   * @param {Boolean} [options.mask] Specifies whether or not to mask `data`
	   * @param {Function} [cb] Callback which is executed when data is written out
	   * @public
	   */
	  send(data, options, cb) {
	    if (this.readyState === WebSocket.CONNECTING) {
	      throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
	    }

	    if (typeof options === 'function') {
	      cb = options;
	      options = {};
	    }

	    if (typeof data === 'number') data = data.toString();

	    if (this.readyState !== WebSocket.OPEN) {
	      sendAfterClose(this, data, cb);
	      return;
	    }

	    const opts = {
	      binary: typeof data !== 'string',
	      mask: !this._isServer,
	      compress: true,
	      fin: true,
	      ...options
	    };

	    if (!this._extensions[PerMessageDeflate.extensionName]) {
	      opts.compress = false;
	    }

	    this._sender.send(data || EMPTY_BUFFER, opts, cb);
	  }

	  /**
	   * Forcibly close the connection.
	   *
	   * @public
	   */
	  terminate() {
	    if (this.readyState === WebSocket.CLOSED) return;
	    if (this.readyState === WebSocket.CONNECTING) {
	      const msg = 'WebSocket was closed before the connection was established';
	      abortHandshake(this, this._req, msg);
	      return;
	    }

	    if (this._socket) {
	      this._readyState = WebSocket.CLOSING;
	      this._socket.destroy();
	    }
	  }
	}

	/**
	 * @constant {Number} CONNECTING
	 * @memberof WebSocket
	 */
	Object.defineProperty(WebSocket, 'CONNECTING', {
	  enumerable: true,
	  value: readyStates.indexOf('CONNECTING')
	});

	/**
	 * @constant {Number} CONNECTING
	 * @memberof WebSocket.prototype
	 */
	Object.defineProperty(WebSocket.prototype, 'CONNECTING', {
	  enumerable: true,
	  value: readyStates.indexOf('CONNECTING')
	});

	/**
	 * @constant {Number} OPEN
	 * @memberof WebSocket
	 */
	Object.defineProperty(WebSocket, 'OPEN', {
	  enumerable: true,
	  value: readyStates.indexOf('OPEN')
	});

	/**
	 * @constant {Number} OPEN
	 * @memberof WebSocket.prototype
	 */
	Object.defineProperty(WebSocket.prototype, 'OPEN', {
	  enumerable: true,
	  value: readyStates.indexOf('OPEN')
	});

	/**
	 * @constant {Number} CLOSING
	 * @memberof WebSocket
	 */
	Object.defineProperty(WebSocket, 'CLOSING', {
	  enumerable: true,
	  value: readyStates.indexOf('CLOSING')
	});

	/**
	 * @constant {Number} CLOSING
	 * @memberof WebSocket.prototype
	 */
	Object.defineProperty(WebSocket.prototype, 'CLOSING', {
	  enumerable: true,
	  value: readyStates.indexOf('CLOSING')
	});

	/**
	 * @constant {Number} CLOSED
	 * @memberof WebSocket
	 */
	Object.defineProperty(WebSocket, 'CLOSED', {
	  enumerable: true,
	  value: readyStates.indexOf('CLOSED')
	});

	/**
	 * @constant {Number} CLOSED
	 * @memberof WebSocket.prototype
	 */
	Object.defineProperty(WebSocket.prototype, 'CLOSED', {
	  enumerable: true,
	  value: readyStates.indexOf('CLOSED')
	});

	[
	  'binaryType',
	  'bufferedAmount',
	  'extensions',
	  'isPaused',
	  'protocol',
	  'readyState',
	  'url'
	].forEach((property) => {
	  Object.defineProperty(WebSocket.prototype, property, { enumerable: true });
	});

	//
	// Add the `onopen`, `onerror`, `onclose`, and `onmessage` attributes.
	// See https://html.spec.whatwg.org/multipage/comms.html#the-websocket-interface
	//
	['open', 'error', 'close', 'message'].forEach((method) => {
	  Object.defineProperty(WebSocket.prototype, `on${method}`, {
	    enumerable: true,
	    get() {
	      for (const listener of this.listeners(method)) {
	        if (listener[kForOnEventAttribute]) return listener[kListener];
	      }

	      return null;
	    },
	    set(handler) {
	      for (const listener of this.listeners(method)) {
	        if (listener[kForOnEventAttribute]) {
	          this.removeListener(method, listener);
	          break;
	        }
	      }

	      if (typeof handler !== 'function') return;

	      this.addEventListener(method, handler, {
	        [kForOnEventAttribute]: true
	      });
	    }
	  });
	});

	WebSocket.prototype.addEventListener = addEventListener;
	WebSocket.prototype.removeEventListener = removeEventListener;

	websocket = WebSocket;

	/**
	 * Initialize a WebSocket client.
	 *
	 * @param {WebSocket} websocket The client to initialize
	 * @param {(String|URL)} address The URL to which to connect
	 * @param {Array} protocols The subprotocols
	 * @param {Object} [options] Connection options
	 * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether any
	 *     of the `'message'`, `'ping'`, and `'pong'` events can be emitted multiple
	 *     times in the same tick
	 * @param {Boolean} [options.autoPong=true] Specifies whether or not to
	 *     automatically send a pong in response to a ping
	 * @param {Number} [options.closeTimeout=30000] Duration in milliseconds to wait
	 *     for the closing handshake to finish after `websocket.close()` is called
	 * @param {Function} [options.finishRequest] A function which can be used to
	 *     customize the headers of each http request before it is sent
	 * @param {Boolean} [options.followRedirects=false] Whether or not to follow
	 *     redirects
	 * @param {Function} [options.generateMask] The function used to generate the
	 *     masking key
	 * @param {Number} [options.handshakeTimeout] Timeout in milliseconds for the
	 *     handshake request
	 * @param {Number} [options.maxBufferedChunks=262144] The maximum number of
	 *     buffered data chunks
	 * @param {Number} [options.maxFragments=16384] The maximum number of message
	 *     fragments
	 * @param {Number} [options.maxPayload=104857600] The maximum allowed message
	 *     size
	 * @param {Number} [options.maxRedirects=10] The maximum number of redirects
	 *     allowed
	 * @param {String} [options.origin] Value of the `Origin` or
	 *     `Sec-WebSocket-Origin` header
	 * @param {(Boolean|Object)} [options.perMessageDeflate=true] Enable/disable
	 *     permessage-deflate
	 * @param {Number} [options.protocolVersion=13] Value of the
	 *     `Sec-WebSocket-Version` header
	 * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
	 *     not to skip UTF-8 validation for text and close messages
	 * @private
	 */
	function initAsClient(websocket, address, protocols, options) {
	  const opts = {
	    allowSynchronousEvents: true,
	    autoPong: true,
	    closeTimeout: CLOSE_TIMEOUT,
	    protocolVersion: protocolVersions[1],
	    maxBufferedChunks: 256 * 1024,
	    maxFragments: 16 * 1024,
	    maxPayload: 100 * 1024 * 1024,
	    skipUTF8Validation: false,
	    perMessageDeflate: true,
	    followRedirects: false,
	    maxRedirects: 10,
	    ...options,
	    socketPath: undefined,
	    hostname: undefined,
	    protocol: undefined,
	    timeout: undefined,
	    method: 'GET',
	    host: undefined,
	    path: undefined,
	    port: undefined
	  };

	  websocket._autoPong = opts.autoPong;
	  websocket._closeTimeout = opts.closeTimeout;

	  if (!protocolVersions.includes(opts.protocolVersion)) {
	    throw new RangeError(
	      `Unsupported protocol version: ${opts.protocolVersion} ` +
	        `(supported versions: ${protocolVersions.join(', ')})`
	    );
	  }

	  let parsedUrl;

	  if (address instanceof URL) {
	    parsedUrl = address;
	  } else {
	    try {
	      parsedUrl = new URL(address);
	    } catch {
	      throw new SyntaxError(`Invalid URL: ${address}`);
	    }
	  }

	  if (parsedUrl.protocol === 'http:') {
	    parsedUrl.protocol = 'ws:';
	  } else if (parsedUrl.protocol === 'https:') {
	    parsedUrl.protocol = 'wss:';
	  }

	  websocket._url = parsedUrl.href;

	  const isSecure = parsedUrl.protocol === 'wss:';
	  const isIpcUrl = parsedUrl.protocol === 'ws+unix:';
	  let invalidUrlMessage;

	  if (parsedUrl.protocol !== 'ws:' && !isSecure && !isIpcUrl) {
	    invalidUrlMessage =
	      'The URL\'s protocol must be one of "ws:", "wss:", ' +
	      '"http:", "https:", or "ws+unix:"';
	  } else if (isIpcUrl && !parsedUrl.pathname) {
	    invalidUrlMessage = "The URL's pathname is empty";
	  } else if (parsedUrl.hash) {
	    invalidUrlMessage = 'The URL contains a fragment identifier';
	  }

	  if (invalidUrlMessage) {
	    const err = new SyntaxError(invalidUrlMessage);

	    if (websocket._redirects === 0) {
	      throw err;
	    } else {
	      emitErrorAndClose(websocket, err);
	      return;
	    }
	  }

	  const defaultPort = isSecure ? 443 : 80;
	  const key = randomBytes(16).toString('base64');
	  const request = isSecure ? https.request : http.request;
	  const protocolSet = new Set();
	  let perMessageDeflate;

	  opts.createConnection =
	    opts.createConnection || (isSecure ? tlsConnect : netConnect);
	  opts.defaultPort = opts.defaultPort || defaultPort;
	  opts.port = parsedUrl.port || defaultPort;
	  opts.host = parsedUrl.hostname.startsWith('[')
	    ? parsedUrl.hostname.slice(1, -1)
	    : parsedUrl.hostname;
	  opts.headers = {
	    ...opts.headers,
	    'Sec-WebSocket-Version': opts.protocolVersion,
	    'Sec-WebSocket-Key': key,
	    Connection: 'Upgrade',
	    Upgrade: 'websocket'
	  };
	  opts.path = parsedUrl.pathname + parsedUrl.search;
	  opts.timeout = opts.handshakeTimeout;

	  if (opts.perMessageDeflate) {
	    perMessageDeflate = new PerMessageDeflate({
	      ...opts.perMessageDeflate,
	      isServer: false,
	      maxPayload: opts.maxPayload
	    });
	    opts.headers['Sec-WebSocket-Extensions'] = format({
	      [PerMessageDeflate.extensionName]: perMessageDeflate.offer()
	    });
	  }
	  if (protocols.length) {
	    for (const protocol of protocols) {
	      if (
	        typeof protocol !== 'string' ||
	        !subprotocolRegex.test(protocol) ||
	        protocolSet.has(protocol)
	      ) {
	        throw new SyntaxError(
	          'An invalid or duplicated subprotocol was specified'
	        );
	      }

	      protocolSet.add(protocol);
	    }

	    opts.headers['Sec-WebSocket-Protocol'] = protocols.join(',');
	  }
	  if (opts.origin) {
	    if (opts.protocolVersion < 13) {
	      opts.headers['Sec-WebSocket-Origin'] = opts.origin;
	    } else {
	      opts.headers.Origin = opts.origin;
	    }
	  }
	  if (parsedUrl.username || parsedUrl.password) {
	    opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
	  }

	  if (isIpcUrl) {
	    const parts = opts.path.split(':');

	    opts.socketPath = parts[0];
	    opts.path = parts[1];
	  }

	  let req;

	  if (opts.followRedirects) {
	    if (websocket._redirects === 0) {
	      websocket._originalIpc = isIpcUrl;
	      websocket._originalSecure = isSecure;
	      websocket._originalHostOrSocketPath = isIpcUrl
	        ? opts.socketPath
	        : parsedUrl.host;

	      const headers = options && options.headers;

	      //
	      // Shallow copy the user provided options so that headers can be changed
	      // without mutating the original object.
	      //
	      options = { ...options, headers: {} };

	      if (headers) {
	        for (const [key, value] of Object.entries(headers)) {
	          options.headers[key.toLowerCase()] = value;
	        }
	      }
	    } else if (websocket.listenerCount('redirect') === 0) {
	      const isSameHost = isIpcUrl
	        ? websocket._originalIpc
	          ? opts.socketPath === websocket._originalHostOrSocketPath
	          : false
	        : websocket._originalIpc
	          ? false
	          : parsedUrl.host === websocket._originalHostOrSocketPath;

	      if (!isSameHost || (websocket._originalSecure && !isSecure)) {
	        //
	        // Match curl 7.77.0 behavior and drop the following headers. These
	        // headers are also dropped when following a redirect to a subdomain.
	        //
	        delete opts.headers.authorization;
	        delete opts.headers.cookie;

	        if (!isSameHost) delete opts.headers.host;

	        opts.auth = undefined;
	      }
	    }

	    //
	    // Match curl 7.77.0 behavior and make the first `Authorization` header win.
	    // If the `Authorization` header is set, then there is nothing to do as it
	    // will take precedence.
	    //
	    if (opts.auth && !options.headers.authorization) {
	      options.headers.authorization =
	        'Basic ' + Buffer.from(opts.auth).toString('base64');
	    }

	    req = websocket._req = request(opts);

	    if (websocket._redirects) {
	      //
	      // Unlike what is done for the `'upgrade'` event, no early exit is
	      // triggered here if the user calls `websocket.close()` or
	      // `websocket.terminate()` from a listener of the `'redirect'` event. This
	      // is because the user can also call `request.destroy()` with an error
	      // before calling `websocket.close()` or `websocket.terminate()` and this
	      // would result in an error being emitted on the `request` object with no
	      // `'error'` event listeners attached.
	      //
	      websocket.emit('redirect', websocket.url, req);
	    }
	  } else {
	    req = websocket._req = request(opts);
	  }

	  if (opts.timeout) {
	    req.on('timeout', () => {
	      abortHandshake(websocket, req, 'Opening handshake has timed out');
	    });
	  }

	  req.on('error', (err) => {
	    if (req === null || req[kAborted]) return;

	    req = websocket._req = null;
	    emitErrorAndClose(websocket, err);
	  });

	  req.on('response', (res) => {
	    const location = res.headers.location;
	    const statusCode = res.statusCode;

	    if (
	      location &&
	      opts.followRedirects &&
	      statusCode >= 300 &&
	      statusCode < 400
	    ) {
	      if (++websocket._redirects > opts.maxRedirects) {
	        abortHandshake(websocket, req, 'Maximum redirects exceeded');
	        return;
	      }

	      req.abort();

	      let addr;

	      try {
	        addr = new URL(location, address);
	      } catch (e) {
	        const err = new SyntaxError(`Invalid URL: ${location}`);
	        emitErrorAndClose(websocket, err);
	        return;
	      }

	      initAsClient(websocket, addr, protocols, options);
	    } else if (!websocket.emit('unexpected-response', req, res)) {
	      abortHandshake(
	        websocket,
	        req,
	        `Unexpected server response: ${res.statusCode}`
	      );
	    }
	  });

	  req.on('upgrade', (res, socket, head) => {
	    websocket.emit('upgrade', res);

	    //
	    // The user may have closed the connection from a listener of the
	    // `'upgrade'` event.
	    //
	    if (websocket.readyState !== WebSocket.CONNECTING) return;

	    req = websocket._req = null;

	    const upgrade = res.headers.upgrade;

	    if (upgrade === undefined || upgrade.toLowerCase() !== 'websocket') {
	      abortHandshake(websocket, socket, 'Invalid Upgrade header');
	      return;
	    }

	    const digest = createHash('sha1')
	      .update(key + GUID)
	      .digest('base64');

	    if (res.headers['sec-websocket-accept'] !== digest) {
	      abortHandshake(websocket, socket, 'Invalid Sec-WebSocket-Accept header');
	      return;
	    }

	    const serverProt = res.headers['sec-websocket-protocol'];
	    let protError;

	    if (serverProt !== undefined) {
	      if (!protocolSet.size) {
	        protError = 'Server sent a subprotocol but none was requested';
	      } else if (!protocolSet.has(serverProt)) {
	        protError = 'Server sent an invalid subprotocol';
	      }
	    } else if (protocolSet.size) {
	      protError = 'Server sent no subprotocol';
	    }

	    if (protError) {
	      abortHandshake(websocket, socket, protError);
	      return;
	    }

	    if (serverProt) websocket._protocol = serverProt;

	    const secWebSocketExtensions = res.headers['sec-websocket-extensions'];

	    if (secWebSocketExtensions !== undefined) {
	      if (!perMessageDeflate) {
	        const message =
	          'Server sent a Sec-WebSocket-Extensions header but no extension ' +
	          'was requested';
	        abortHandshake(websocket, socket, message);
	        return;
	      }

	      let extensions;

	      try {
	        extensions = parse(secWebSocketExtensions);
	      } catch (err) {
	        const message = 'Invalid Sec-WebSocket-Extensions header';
	        abortHandshake(websocket, socket, message);
	        return;
	      }

	      const extensionNames = Object.keys(extensions);

	      if (
	        extensionNames.length !== 1 ||
	        extensionNames[0] !== PerMessageDeflate.extensionName
	      ) {
	        const message = 'Server indicated an extension that was not requested';
	        abortHandshake(websocket, socket, message);
	        return;
	      }

	      try {
	        perMessageDeflate.accept(extensions[PerMessageDeflate.extensionName]);
	      } catch (err) {
	        const message = 'Invalid Sec-WebSocket-Extensions header';
	        abortHandshake(websocket, socket, message);
	        return;
	      }

	      websocket._extensions[PerMessageDeflate.extensionName] =
	        perMessageDeflate;
	    }

	    websocket.setSocket(socket, head, {
	      allowSynchronousEvents: opts.allowSynchronousEvents,
	      generateMask: opts.generateMask,
	      maxBufferedChunks: opts.maxBufferedChunks,
	      maxFragments: opts.maxFragments,
	      maxPayload: opts.maxPayload,
	      skipUTF8Validation: opts.skipUTF8Validation
	    });
	  });

	  if (opts.finishRequest) {
	    opts.finishRequest(req, websocket);
	  } else {
	    req.end();
	  }
	}

	/**
	 * Emit the `'error'` and `'close'` events.
	 *
	 * @param {WebSocket} websocket The WebSocket instance
	 * @param {Error} The error to emit
	 * @private
	 */
	function emitErrorAndClose(websocket, err) {
	  websocket._readyState = WebSocket.CLOSING;
	  //
	  // The following assignment is practically useless and is done only for
	  // consistency.
	  //
	  websocket._errorEmitted = true;
	  websocket.emit('error', err);
	  websocket.emitClose();
	}

	/**
	 * Create a `net.Socket` and initiate a connection.
	 *
	 * @param {Object} options Connection options
	 * @return {net.Socket} The newly created socket used to start the connection
	 * @private
	 */
	function netConnect(options) {
	  options.path = options.socketPath;
	  return net.connect(options);
	}

	/**
	 * Create a `tls.TLSSocket` and initiate a connection.
	 *
	 * @param {Object} options Connection options
	 * @return {tls.TLSSocket} The newly created socket used to start the connection
	 * @private
	 */
	function tlsConnect(options) {
	  options.path = undefined;

	  if (!options.servername && options.servername !== '') {
	    options.servername = net.isIP(options.host) ? '' : options.host;
	  }

	  return tls.connect(options);
	}

	/**
	 * Abort the handshake and emit an error.
	 *
	 * @param {WebSocket} websocket The WebSocket instance
	 * @param {(http.ClientRequest|net.Socket|tls.Socket)} stream The request to
	 *     abort or the socket to destroy
	 * @param {String} message The error message
	 * @private
	 */
	function abortHandshake(websocket, stream, message) {
	  websocket._readyState = WebSocket.CLOSING;

	  const err = new Error(message);
	  Error.captureStackTrace(err, abortHandshake);

	  if (stream.setHeader) {
	    stream[kAborted] = true;
	    stream.abort();

	    if (stream.socket && !stream.socket.destroyed) {
	      //
	      // On Node.js >= 14.3.0 `request.abort()` does not destroy the socket if
	      // called after the request completed. See
	      // https://github.com/websockets/ws/issues/1869.
	      //
	      stream.socket.destroy();
	    }

	    process.nextTick(emitErrorAndClose, websocket, err);
	  } else {
	    stream.destroy(err);
	    stream.once('error', websocket.emit.bind(websocket, 'error'));
	    stream.once('close', websocket.emitClose.bind(websocket));
	  }
	}

	/**
	 * Handle cases where the `ping()`, `pong()`, or `send()` methods are called
	 * when the `readyState` attribute is `CLOSING` or `CLOSED`.
	 *
	 * @param {WebSocket} websocket The WebSocket instance
	 * @param {*} [data] The data to send
	 * @param {Function} [cb] Callback
	 * @private
	 */
	function sendAfterClose(websocket, data, cb) {
	  if (data) {
	    const length = isBlob(data) ? data.size : toBuffer(data).length;

	    //
	    // The `_bufferedAmount` property is used only when the peer is a client and
	    // the opening handshake fails. Under these circumstances, in fact, the
	    // `setSocket()` method is not called, so the `_socket` and `_sender`
	    // properties are set to `null`.
	    //
	    if (websocket._socket) websocket._sender._bufferedBytes += length;
	    else websocket._bufferedAmount += length;
	  }

	  if (cb) {
	    const err = new Error(
	      `WebSocket is not open: readyState ${websocket.readyState} ` +
	        `(${readyStates[websocket.readyState]})`
	    );
	    process.nextTick(cb, err);
	  }
	}

	/**
	 * The listener of the `Receiver` `'conclude'` event.
	 *
	 * @param {Number} code The status code
	 * @param {Buffer} reason The reason for closing
	 * @private
	 */
	function receiverOnConclude(code, reason) {
	  const websocket = this[kWebSocket];

	  websocket._closeFrameReceived = true;
	  websocket._closeMessage = reason;
	  websocket._closeCode = code;

	  if (websocket._socket[kWebSocket] === undefined) return;

	  websocket._socket.removeListener('data', socketOnData);
	  process.nextTick(resume, websocket._socket);

	  if (code === 1005) websocket.close();
	  else websocket.close(code, reason);
	}

	/**
	 * The listener of the `Receiver` `'drain'` event.
	 *
	 * @private
	 */
	function receiverOnDrain() {
	  const websocket = this[kWebSocket];

	  if (!websocket.isPaused) websocket._socket.resume();
	}

	/**
	 * The listener of the `Receiver` `'error'` event.
	 *
	 * @param {(RangeError|Error)} err The emitted error
	 * @private
	 */
	function receiverOnError(err) {
	  const websocket = this[kWebSocket];

	  if (websocket._socket[kWebSocket] !== undefined) {
	    websocket._socket.removeListener('data', socketOnData);

	    //
	    // On Node.js < 14.0.0 the `'error'` event is emitted synchronously. See
	    // https://github.com/websockets/ws/issues/1940.
	    //
	    process.nextTick(resume, websocket._socket);

	    websocket.close(err[kStatusCode]);
	  }

	  if (!websocket._errorEmitted) {
	    websocket._errorEmitted = true;
	    websocket.emit('error', err);
	  }
	}

	/**
	 * The listener of the `Receiver` `'finish'` event.
	 *
	 * @private
	 */
	function receiverOnFinish() {
	  this[kWebSocket].emitClose();
	}

	/**
	 * The listener of the `Receiver` `'message'` event.
	 *
	 * @param {Buffer|ArrayBuffer|Buffer[])} data The message
	 * @param {Boolean} isBinary Specifies whether the message is binary or not
	 * @private
	 */
	function receiverOnMessage(data, isBinary) {
	  this[kWebSocket].emit('message', data, isBinary);
	}

	/**
	 * The listener of the `Receiver` `'ping'` event.
	 *
	 * @param {Buffer} data The data included in the ping frame
	 * @private
	 */
	function receiverOnPing(data) {
	  const websocket = this[kWebSocket];

	  if (websocket._autoPong) websocket.pong(data, !this._isServer, NOOP);
	  websocket.emit('ping', data);
	}

	/**
	 * The listener of the `Receiver` `'pong'` event.
	 *
	 * @param {Buffer} data The data included in the pong frame
	 * @private
	 */
	function receiverOnPong(data) {
	  this[kWebSocket].emit('pong', data);
	}

	/**
	 * Resume a readable stream
	 *
	 * @param {Readable} stream The readable stream
	 * @private
	 */
	function resume(stream) {
	  stream.resume();
	}

	/**
	 * The `Sender` error event handler.
	 *
	 * @param {Error} The error
	 * @private
	 */
	function senderOnError(err) {
	  const websocket = this[kWebSocket];

	  if (websocket.readyState === WebSocket.CLOSED) return;
	  if (websocket.readyState === WebSocket.OPEN) {
	    websocket._readyState = WebSocket.CLOSING;
	    setCloseTimer(websocket);
	  }

	  //
	  // `socket.end()` is used instead of `socket.destroy()` to allow the other
	  // peer to finish sending queued data. There is no need to set a timer here
	  // because `CLOSING` means that it is already set or not needed.
	  //
	  this._socket.end();

	  if (!websocket._errorEmitted) {
	    websocket._errorEmitted = true;
	    websocket.emit('error', err);
	  }
	}

	/**
	 * Set a timer to destroy the underlying raw socket of a WebSocket.
	 *
	 * @param {WebSocket} websocket The WebSocket instance
	 * @private
	 */
	function setCloseTimer(websocket) {
	  websocket._closeTimer = setTimeout(
	    websocket._socket.destroy.bind(websocket._socket),
	    websocket._closeTimeout
	  );
	}

	/**
	 * The listener of the socket `'close'` event.
	 *
	 * @private
	 */
	function socketOnClose() {
	  const websocket = this[kWebSocket];

	  this.removeListener('close', socketOnClose);
	  this.removeListener('data', socketOnData);
	  this.removeListener('end', socketOnEnd);

	  websocket._readyState = WebSocket.CLOSING;

	  //
	  // The close frame might not have been received or the `'end'` event emitted,
	  // for example, if the socket was destroyed due to an error. Ensure that the
	  // `receiver` stream is closed after writing any remaining buffered data to
	  // it. If the readable side of the socket is in flowing mode then there is no
	  // buffered data as everything has been already written. If instead, the
	  // socket is paused, any possible buffered data will be read as a single
	  // chunk.
	  //
	  if (
	    !this._readableState.endEmitted &&
	    !websocket._closeFrameReceived &&
	    !websocket._receiver._writableState.errorEmitted &&
	    this._readableState.length !== 0
	  ) {
	    const chunk = this.read(this._readableState.length);

	    websocket._receiver.write(chunk);
	  }

	  websocket._receiver.end();

	  this[kWebSocket] = undefined;

	  clearTimeout(websocket._closeTimer);

	  if (
	    websocket._receiver._writableState.finished ||
	    websocket._receiver._writableState.errorEmitted
	  ) {
	    websocket.emitClose();
	  } else {
	    websocket._receiver.on('error', receiverOnFinish);
	    websocket._receiver.on('finish', receiverOnFinish);
	  }
	}

	/**
	 * The listener of the socket `'data'` event.
	 *
	 * @param {Buffer} chunk A chunk of data
	 * @private
	 */
	function socketOnData(chunk) {
	  if (!this[kWebSocket]._receiver.write(chunk)) {
	    this.pause();
	  }
	}

	/**
	 * The listener of the socket `'end'` event.
	 *
	 * @private
	 */
	function socketOnEnd() {
	  const websocket = this[kWebSocket];

	  websocket._readyState = WebSocket.CLOSING;
	  websocket._receiver.end();
	  this.end();
	}

	/**
	 * The listener of the socket `'error'` event.
	 *
	 * @private
	 */
	function socketOnError() {
	  const websocket = this[kWebSocket];

	  this.removeListener('error', socketOnError);
	  this.on('error', NOOP);

	  if (websocket) {
	    websocket._readyState = WebSocket.CLOSING;
	    this.destroy();
	  }
	}
	return websocket;
}

/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "^WebSocket$" }] */

var stream;
var hasRequiredStream;

function requireStream () {
	if (hasRequiredStream) return stream;
	hasRequiredStream = 1;

	requireWebsocket();
	const { Duplex } = require$$0$2;

	/**
	 * Emits the `'close'` event on a stream.
	 *
	 * @param {Duplex} stream The stream.
	 * @private
	 */
	function emitClose(stream) {
	  stream.emit('close');
	}

	/**
	 * The listener of the `'end'` event.
	 *
	 * @private
	 */
	function duplexOnEnd() {
	  if (!this.destroyed && this._writableState.finished) {
	    this.destroy();
	  }
	}

	/**
	 * The listener of the `'error'` event.
	 *
	 * @param {Error} err The error
	 * @private
	 */
	function duplexOnError(err) {
	  this.removeListener('error', duplexOnError);
	  this.destroy();
	  if (this.listenerCount('error') === 0) {
	    // Do not suppress the throwing behavior.
	    this.emit('error', err);
	  }
	}

	/**
	 * Wraps a `WebSocket` in a duplex stream.
	 *
	 * @param {WebSocket} ws The `WebSocket` to wrap
	 * @param {Object} [options] The options for the `Duplex` constructor
	 * @return {Duplex} The duplex stream
	 * @public
	 */
	function createWebSocketStream(ws, options) {
	  let terminateOnDestroy = true;

	  const duplex = new Duplex({
	    ...options,
	    autoDestroy: false,
	    emitClose: false,
	    objectMode: false,
	    writableObjectMode: false
	  });

	  ws.on('message', function message(msg, isBinary) {
	    const data =
	      !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;

	    if (!duplex.push(data)) ws.pause();
	  });

	  ws.once('error', function error(err) {
	    if (duplex.destroyed) return;

	    // Prevent `ws.terminate()` from being called by `duplex._destroy()`.
	    //
	    // - If the `'error'` event is emitted before the `'open'` event, then
	    //   `ws.terminate()` is a noop as no socket is assigned.
	    // - Otherwise, the error is re-emitted by the listener of the `'error'`
	    //   event of the `Receiver` object. The listener already closes the
	    //   connection by calling `ws.close()`. This allows a close frame to be
	    //   sent to the other peer. If `ws.terminate()` is called right after this,
	    //   then the close frame might not be sent.
	    terminateOnDestroy = false;
	    duplex.destroy(err);
	  });

	  ws.once('close', function close() {
	    if (duplex.destroyed) return;

	    duplex.push(null);
	  });

	  duplex._destroy = function (err, callback) {
	    if (ws.readyState === ws.CLOSED) {
	      callback(err);
	      process.nextTick(emitClose, duplex);
	      return;
	    }

	    let called = false;

	    ws.once('error', function error(err) {
	      called = true;
	      callback(err);
	    });

	    ws.once('close', function close() {
	      if (!called) callback(err);
	      process.nextTick(emitClose, duplex);
	    });

	    if (terminateOnDestroy) ws.terminate();
	  };

	  duplex._final = function (callback) {
	    if (ws.readyState === ws.CONNECTING) {
	      ws.once('open', function open() {
	        duplex._final(callback);
	      });
	      return;
	    }

	    // If the value of the `_socket` property is `null` it means that `ws` is a
	    // client websocket and the handshake failed. In fact, when this happens, a
	    // socket is never assigned to the websocket. Wait for the `'error'` event
	    // that will be emitted by the websocket.
	    if (ws._socket === null) return;

	    if (ws._socket._writableState.finished) {
	      callback();
	      if (duplex._readableState.endEmitted) duplex.destroy();
	    } else {
	      ws._socket.once('finish', function finish() {
	        // `duplex` is not destroyed here because the `'end'` event will be
	        // emitted on `duplex` after this `'finish'` event. The EOF signaling
	        // `null` chunk is, in fact, pushed when the websocket emits `'close'`.
	        callback();
	      });
	      ws.close();
	    }
	  };

	  duplex._read = function () {
	    if (ws.isPaused) ws.resume();
	  };

	  duplex._write = function (chunk, encoding, callback) {
	    if (ws.readyState === ws.CONNECTING) {
	      ws.once('open', function open() {
	        duplex._write(chunk, encoding, callback);
	      });
	      return;
	    }

	    ws.send(chunk, callback);
	  };

	  duplex.on('end', duplexOnEnd);
	  duplex.on('error', duplexOnError);
	  return duplex;
	}

	stream = createWebSocketStream;
	return stream;
}

requireStream();

requireExtension();

requirePermessageDeflate();

requireReceiver();

requireSender();

var subprotocol;
var hasRequiredSubprotocol;

function requireSubprotocol () {
	if (hasRequiredSubprotocol) return subprotocol;
	hasRequiredSubprotocol = 1;

	const { tokenChars } = requireValidation();

	/**
	 * Parses the `Sec-WebSocket-Protocol` header into a set of subprotocol names.
	 *
	 * @param {String} header The field value of the header
	 * @return {Set} The subprotocol names
	 * @public
	 */
	function parse(header) {
	  const protocols = new Set();
	  let start = -1;
	  let end = -1;
	  let i = 0;

	  for (i; i < header.length; i++) {
	    const code = header.charCodeAt(i);

	    if (end === -1 && tokenChars[code] === 1) {
	      if (start === -1) start = i;
	    } else if (
	      i !== 0 &&
	      (code === 0x20 /* ' ' */ || code === 0x09) /* '\t' */
	    ) {
	      if (end === -1 && start !== -1) end = i;
	    } else if (code === 0x2c /* ',' */) {
	      if (start === -1) {
	        throw new SyntaxError(`Unexpected character at index ${i}`);
	      }

	      if (end === -1) end = i;

	      const protocol = header.slice(start, end);

	      if (protocols.has(protocol)) {
	        throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
	      }

	      protocols.add(protocol);
	      start = end = -1;
	    } else {
	      throw new SyntaxError(`Unexpected character at index ${i}`);
	    }
	  }

	  if (start === -1 || end !== -1) {
	    throw new SyntaxError('Unexpected end of input');
	  }

	  const protocol = header.slice(start, i);

	  if (protocols.has(protocol)) {
	    throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
	  }

	  protocols.add(protocol);
	  return protocols;
	}

	subprotocol = { parse };
	return subprotocol;
}

requireSubprotocol();

requireWebsocket();

/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "^Duplex$", "caughtErrors": "none" }] */

var websocketServer;
var hasRequiredWebsocketServer;

function requireWebsocketServer () {
	if (hasRequiredWebsocketServer) return websocketServer;
	hasRequiredWebsocketServer = 1;

	const EventEmitter = require$$0$3;
	const http = require$$2$1;
	const { Duplex } = require$$0$2;
	const { createHash } = require$$1;

	const extension = requireExtension();
	const PerMessageDeflate = requirePermessageDeflate();
	const subprotocol = requireSubprotocol();
	const WebSocket = requireWebsocket();
	const { CLOSE_TIMEOUT, GUID, kWebSocket } = requireConstants();

	const keyRegex = /^[+/0-9A-Za-z]{22}==$/;

	const RUNNING = 0;
	const CLOSING = 1;
	const CLOSED = 2;

	/**
	 * Class representing a WebSocket server.
	 *
	 * @extends EventEmitter
	 */
	class WebSocketServer extends EventEmitter {
	  /**
	   * Create a `WebSocketServer` instance.
	   *
	   * @param {Object} options Configuration options
	   * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
	   *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
	   *     multiple times in the same tick
	   * @param {Boolean} [options.autoPong=true] Specifies whether or not to
	   *     automatically send a pong in response to a ping
	   * @param {Number} [options.backlog=511] The maximum length of the queue of
	   *     pending connections
	   * @param {Boolean} [options.clientTracking=true] Specifies whether or not to
	   *     track clients
	   * @param {Number} [options.closeTimeout=30000] Duration in milliseconds to
	   *     wait for the closing handshake to finish after `websocket.close()` is
	   *     called
	   * @param {Function} [options.handleProtocols] A hook to handle protocols
	   * @param {String} [options.host] The hostname where to bind the server
	   * @param {Number} [options.maxBufferedChunks=262144] The maximum number of
	   *     buffered data chunks
	   * @param {Number} [options.maxFragments=16384] The maximum number of message
	   *     fragments
	   * @param {Number} [options.maxPayload=104857600] The maximum allowed message
	   *     size
	   * @param {Boolean} [options.noServer=false] Enable no server mode
	   * @param {String} [options.path] Accept only connections matching this path
	   * @param {(Boolean|Object)} [options.perMessageDeflate=false] Enable/disable
	   *     permessage-deflate
	   * @param {Number} [options.port] The port where to bind the server
	   * @param {(http.Server|https.Server)} [options.server] A pre-created HTTP/S
	   *     server to use
	   * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
	   *     not to skip UTF-8 validation for text and close messages
	   * @param {Function} [options.verifyClient] A hook to reject connections
	   * @param {Function} [options.WebSocket=WebSocket] Specifies the `WebSocket`
	   *     class to use. It must be the `WebSocket` class or class that extends it
	   * @param {Function} [callback] A listener for the `listening` event
	   */
	  constructor(options, callback) {
	    super();

	    options = {
	      allowSynchronousEvents: true,
	      autoPong: true,
	      maxBufferedChunks: 256 * 1024,
	      maxFragments: 16 * 1024,
	      maxPayload: 100 * 1024 * 1024,
	      skipUTF8Validation: false,
	      perMessageDeflate: false,
	      handleProtocols: null,
	      clientTracking: true,
	      closeTimeout: CLOSE_TIMEOUT,
	      verifyClient: null,
	      noServer: false,
	      backlog: null, // use default (511 as implemented in net.js)
	      server: null,
	      host: null,
	      path: null,
	      port: null,
	      WebSocket,
	      ...options
	    };

	    if (
	      (options.port == null && !options.server && !options.noServer) ||
	      (options.port != null && (options.server || options.noServer)) ||
	      (options.server && options.noServer)
	    ) {
	      throw new TypeError(
	        'One and only one of the "port", "server", or "noServer" options ' +
	          'must be specified'
	      );
	    }

	    if (options.port != null) {
	      this._server = http.createServer((req, res) => {
	        const body = http.STATUS_CODES[426];

	        res.writeHead(426, {
	          'Content-Length': body.length,
	          'Content-Type': 'text/plain'
	        });
	        res.end(body);
	      });
	      this._server.listen(
	        options.port,
	        options.host,
	        options.backlog,
	        callback
	      );
	    } else if (options.server) {
	      this._server = options.server;
	    }

	    if (this._server) {
	      const emitConnection = this.emit.bind(this, 'connection');

	      this._removeListeners = addListeners(this._server, {
	        listening: this.emit.bind(this, 'listening'),
	        error: this.emit.bind(this, 'error'),
	        upgrade: (req, socket, head) => {
	          this.handleUpgrade(req, socket, head, emitConnection);
	        }
	      });
	    }

	    if (options.perMessageDeflate === true) options.perMessageDeflate = {};
	    if (options.clientTracking) {
	      this.clients = new Set();
	      this._shouldEmitClose = false;
	    }

	    this.options = options;
	    this._state = RUNNING;
	  }

	  /**
	   * Returns the bound address, the address family name, and port of the server
	   * as reported by the operating system if listening on an IP socket.
	   * If the server is listening on a pipe or UNIX domain socket, the name is
	   * returned as a string.
	   *
	   * @return {(Object|String|null)} The address of the server
	   * @public
	   */
	  address() {
	    if (this.options.noServer) {
	      throw new Error('The server is operating in "noServer" mode');
	    }

	    if (!this._server) return null;
	    return this._server.address();
	  }

	  /**
	   * Stop the server from accepting new connections and emit the `'close'` event
	   * when all existing connections are closed.
	   *
	   * @param {Function} [cb] A one-time listener for the `'close'` event
	   * @public
	   */
	  close(cb) {
	    if (this._state === CLOSED) {
	      if (cb) {
	        this.once('close', () => {
	          cb(new Error('The server is not running'));
	        });
	      }

	      process.nextTick(emitClose, this);
	      return;
	    }

	    if (cb) this.once('close', cb);

	    if (this._state === CLOSING) return;
	    this._state = CLOSING;

	    if (this.options.noServer || this.options.server) {
	      if (this._server) {
	        this._removeListeners();
	        this._removeListeners = this._server = null;
	      }

	      if (this.clients) {
	        if (!this.clients.size) {
	          process.nextTick(emitClose, this);
	        } else {
	          this._shouldEmitClose = true;
	        }
	      } else {
	        process.nextTick(emitClose, this);
	      }
	    } else {
	      const server = this._server;

	      this._removeListeners();
	      this._removeListeners = this._server = null;

	      //
	      // The HTTP/S server was created internally. Close it, and rely on its
	      // `'close'` event.
	      //
	      server.close(() => {
	        emitClose(this);
	      });
	    }
	  }

	  /**
	   * See if a given request should be handled by this server instance.
	   *
	   * @param {http.IncomingMessage} req Request object to inspect
	   * @return {Boolean} `true` if the request is valid, else `false`
	   * @public
	   */
	  shouldHandle(req) {
	    if (this.options.path) {
	      const index = req.url.indexOf('?');
	      const pathname = index !== -1 ? req.url.slice(0, index) : req.url;

	      if (pathname !== this.options.path) return false;
	    }

	    return true;
	  }

	  /**
	   * Handle a HTTP Upgrade request.
	   *
	   * @param {http.IncomingMessage} req The request object
	   * @param {Duplex} socket The network socket between the server and client
	   * @param {Buffer} head The first packet of the upgraded stream
	   * @param {Function} cb Callback
	   * @public
	   */
	  handleUpgrade(req, socket, head, cb) {
	    socket.on('error', socketOnError);

	    const key = req.headers['sec-websocket-key'];
	    const upgrade = req.headers.upgrade;
	    const version = +req.headers['sec-websocket-version'];

	    if (req.method !== 'GET') {
	      const message = 'Invalid HTTP method';
	      abortHandshakeOrEmitwsClientError(this, req, socket, 405, message);
	      return;
	    }

	    if (upgrade === undefined || upgrade.toLowerCase() !== 'websocket') {
	      const message = 'Invalid Upgrade header';
	      abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
	      return;
	    }

	    if (key === undefined || !keyRegex.test(key)) {
	      const message = 'Missing or invalid Sec-WebSocket-Key header';
	      abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
	      return;
	    }

	    if (version !== 13 && version !== 8) {
	      const message = 'Missing or invalid Sec-WebSocket-Version header';
	      abortHandshakeOrEmitwsClientError(this, req, socket, 400, message, {
	        'Sec-WebSocket-Version': '13, 8'
	      });
	      return;
	    }

	    if (!this.shouldHandle(req)) {
	      abortHandshake(socket, 400);
	      return;
	    }

	    const secWebSocketProtocol = req.headers['sec-websocket-protocol'];
	    let protocols = new Set();

	    if (secWebSocketProtocol !== undefined) {
	      try {
	        protocols = subprotocol.parse(secWebSocketProtocol);
	      } catch (err) {
	        const message = 'Invalid Sec-WebSocket-Protocol header';
	        abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
	        return;
	      }
	    }

	    const secWebSocketExtensions = req.headers['sec-websocket-extensions'];
	    const extensions = {};

	    if (
	      this.options.perMessageDeflate &&
	      secWebSocketExtensions !== undefined
	    ) {
	      const perMessageDeflate = new PerMessageDeflate({
	        ...this.options.perMessageDeflate,
	        isServer: true,
	        maxPayload: this.options.maxPayload
	      });

	      try {
	        const offers = extension.parse(secWebSocketExtensions);

	        if (offers[PerMessageDeflate.extensionName]) {
	          perMessageDeflate.accept(offers[PerMessageDeflate.extensionName]);
	          extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
	        }
	      } catch (err) {
	        const message =
	          'Invalid or unacceptable Sec-WebSocket-Extensions header';
	        abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
	        return;
	      }
	    }

	    //
	    // Optionally call external client verification handler.
	    //
	    if (this.options.verifyClient) {
	      const info = {
	        origin:
	          req.headers[`${version === 8 ? 'sec-websocket-origin' : 'origin'}`],
	        secure: !!(req.socket.authorized || req.socket.encrypted),
	        req
	      };

	      if (this.options.verifyClient.length === 2) {
	        this.options.verifyClient(info, (verified, code, message, headers) => {
	          if (!verified) {
	            return abortHandshake(socket, code || 401, message, headers);
	          }

	          this.completeUpgrade(
	            extensions,
	            key,
	            protocols,
	            req,
	            socket,
	            head,
	            cb
	          );
	        });
	        return;
	      }

	      if (!this.options.verifyClient(info)) return abortHandshake(socket, 401);
	    }

	    this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
	  }

	  /**
	   * Upgrade the connection to WebSocket.
	   *
	   * @param {Object} extensions The accepted extensions
	   * @param {String} key The value of the `Sec-WebSocket-Key` header
	   * @param {Set} protocols The subprotocols
	   * @param {http.IncomingMessage} req The request object
	   * @param {Duplex} socket The network socket between the server and client
	   * @param {Buffer} head The first packet of the upgraded stream
	   * @param {Function} cb Callback
	   * @throws {Error} If called more than once with the same socket
	   * @private
	   */
	  completeUpgrade(extensions, key, protocols, req, socket, head, cb) {
	    //
	    // Destroy the socket if the client has already sent a FIN packet.
	    //
	    if (!socket.readable || !socket.writable) return socket.destroy();

	    if (socket[kWebSocket]) {
	      throw new Error(
	        'server.handleUpgrade() was called more than once with the same ' +
	          'socket, possibly due to a misconfiguration'
	      );
	    }

	    if (this._state > RUNNING) return abortHandshake(socket, 503);

	    const digest = createHash('sha1')
	      .update(key + GUID)
	      .digest('base64');

	    const headers = [
	      'HTTP/1.1 101 Switching Protocols',
	      'Upgrade: websocket',
	      'Connection: Upgrade',
	      `Sec-WebSocket-Accept: ${digest}`
	    ];

	    const ws = new this.options.WebSocket(null, undefined, this.options);

	    if (protocols.size) {
	      //
	      // Optionally call external protocol selection handler.
	      //
	      const protocol = this.options.handleProtocols
	        ? this.options.handleProtocols(protocols, req)
	        : protocols.values().next().value;

	      if (protocol) {
	        headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
	        ws._protocol = protocol;
	      }
	    }

	    if (extensions[PerMessageDeflate.extensionName]) {
	      const params = extensions[PerMessageDeflate.extensionName].params;
	      const value = extension.format({
	        [PerMessageDeflate.extensionName]: [params]
	      });
	      headers.push(`Sec-WebSocket-Extensions: ${value}`);
	      ws._extensions = extensions;
	    }

	    //
	    // Allow external modification/inspection of handshake headers.
	    //
	    this.emit('headers', headers, req);

	    socket.write(headers.concat('\r\n').join('\r\n'));
	    socket.removeListener('error', socketOnError);

	    ws.setSocket(socket, head, {
	      allowSynchronousEvents: this.options.allowSynchronousEvents,
	      maxBufferedChunks: this.options.maxBufferedChunks,
	      maxFragments: this.options.maxFragments,
	      maxPayload: this.options.maxPayload,
	      skipUTF8Validation: this.options.skipUTF8Validation
	    });

	    if (this.clients) {
	      this.clients.add(ws);
	      ws.on('close', () => {
	        this.clients.delete(ws);

	        if (this._shouldEmitClose && !this.clients.size) {
	          process.nextTick(emitClose, this);
	        }
	      });
	    }

	    cb(ws, req);
	  }
	}

	websocketServer = WebSocketServer;

	/**
	 * Add event listeners on an `EventEmitter` using a map of <event, listener>
	 * pairs.
	 *
	 * @param {EventEmitter} server The event emitter
	 * @param {Object.<String, Function>} map The listeners to add
	 * @return {Function} A function that will remove the added listeners when
	 *     called
	 * @private
	 */
	function addListeners(server, map) {
	  for (const event of Object.keys(map)) server.on(event, map[event]);

	  return function removeListeners() {
	    for (const event of Object.keys(map)) {
	      server.removeListener(event, map[event]);
	    }
	  };
	}

	/**
	 * Emit a `'close'` event on an `EventEmitter`.
	 *
	 * @param {EventEmitter} server The event emitter
	 * @private
	 */
	function emitClose(server) {
	  server._state = CLOSED;
	  server.emit('close');
	}

	/**
	 * Handle socket errors.
	 *
	 * @private
	 */
	function socketOnError() {
	  this.destroy();
	}

	/**
	 * Close the connection when preconditions are not fulfilled.
	 *
	 * @param {Duplex} socket The socket of the upgrade request
	 * @param {Number} code The HTTP response status code
	 * @param {String} [message] The HTTP response body
	 * @param {Object} [headers] Additional HTTP response headers
	 * @private
	 */
	function abortHandshake(socket, code, message, headers) {
	  //
	  // The socket is writable unless the user destroyed or ended it before calling
	  // `server.handleUpgrade()` or in the `verifyClient` function, which is a user
	  // error. Handling this does not make much sense as the worst that can happen
	  // is that some of the data written by the user might be discarded due to the
	  // call to `socket.end()` below, which triggers an `'error'` event that in
	  // turn causes the socket to be destroyed.
	  //
	  message = message || http.STATUS_CODES[code];
	  headers = {
	    Connection: 'close',
	    'Content-Type': 'text/html',
	    'Content-Length': Buffer.byteLength(message),
	    ...headers
	  };

	  socket.once('finish', socket.destroy);

	  socket.end(
	    `HTTP/1.1 ${code} ${http.STATUS_CODES[code]}\r\n` +
	      Object.keys(headers)
	        .map((h) => `${h}: ${headers[h]}`)
	        .join('\r\n') +
	      '\r\n\r\n' +
	      message
	  );
	}

	/**
	 * Emit a `'wsClientError'` event on a `WebSocketServer` if there is at least
	 * one listener for it, otherwise call `abortHandshake()`.
	 *
	 * @param {WebSocketServer} server The WebSocket server
	 * @param {http.IncomingMessage} req The request object
	 * @param {Duplex} socket The socket of the upgrade request
	 * @param {Number} code The HTTP response status code
	 * @param {String} message The HTTP response body
	 * @param {Object} [headers] The HTTP response headers
	 * @private
	 */
	function abortHandshakeOrEmitwsClientError(
	  server,
	  req,
	  socket,
	  code,
	  message,
	  headers
	) {
	  if (server.listenerCount('wsClientError')) {
	    const err = new Error(message);
	    Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);

	    server.emit('wsClientError', err, socket, req);
	  } else {
	    abortHandshake(socket, code, message, headers);
	  }
	}
	return websocketServer;
}

var websocketServerExports = requireWebsocketServer();
var WebSocketServer = /*@__PURE__*/getDefaultExportFromCjs(websocketServerExports);

const PROTOCOL_VERSION = 1;
const REQUEST_TIMEOUT_MS = 30000;

/**
 * ExtensionBridge — the daemon side of the local aux4 ⇄ Chrome-extension link.
 *
 * MV3 extensions can only dial out, so the daemon is the WebSocket *server* and
 * the extension connects to it. The bridge owns:
 *   - the pairing handshake (token + protocol version),
   *   - a single active extension connection per Chrome profile,
 *   - request/response correlation by id, with timeouts.
 *
 * See https://github.com/aux4/browser-connector/blob/main/PROTOCOL.md for the wire contract.
 */
class ExtensionBridge {
  constructor({ port = 8765, token }) {
    this.port = port;
    this.token = token;
    this.wss = null;
    this.socket = null;        // the one paired extension
    this.pending = new Map();  // id -> { resolve, reject, timer }
    this.nextId = 1;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ host: "127.0.0.1", port: this.port });
      this.wss.on("listening", () => {
        this.wss.on("connection", (ws) => this._onConnection(ws));
        resolve();
      });
      this.wss.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
          reject(new Error(
            `WebSocket port ${this.port} is already in use — is another ` +
            `\`aux4 browser connect\` running? Try \`aux4 browser stop\` or pass a different --port.`
          ));
        } else {
          reject(err);
        }
      });
    });
  }

  _onConnection(ws) {
    let paired = false;

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (!paired) {
        // First frame must be the handshake.
        if (msg.type !== "hello") {
          ws.send(JSON.stringify({ type: "error", reason: "expected-hello" }));
          ws.close();
          return;
        }
        if (!this._validToken(msg.token)) {
          ws.send(JSON.stringify({ type: "error", reason: "bad-token" }));
          ws.close();
          return;
        }
        if (msg.protocolVersion !== PROTOCOL_VERSION) {
          ws.send(JSON.stringify({
            type: "error",
            reason: "version-mismatch",
            expected: PROTOCOL_VERSION
          }));
          ws.close();
          return;
        }
        paired = true;
        // Replace any prior connection with the newest one.
        if (this.socket && this.socket !== ws) {
          try { this.socket.close(); } catch {}
        }
        this.socket = ws;
        ws.send(JSON.stringify({ type: "welcome", protocolVersion: PROTOCOL_VERSION }));
        return;
      }

      // Post-handshake: a response to a pending request.
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || "extension error"));
        else resolve(msg.result);
      }
    });

    ws.on("close", () => {
      if (this.socket === ws) {
        this.socket = null;
        for (const { reject, timer } of this.pending.values()) {
          clearTimeout(timer);
          reject(new Error("Chrome extension disconnected while the request was in flight"));
        }
        this.pending.clear();
      }
    });
    ws.on("error", () => {});
  }

  _validToken(token) {
    if (typeof token !== "string" || token.length !== this.token.length) return false;
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(this.token));
  }

  isConnected() {
    return this.socket != null && this.socket.readyState === 1;
  }

  /**
   * Send a method call to the paired extension and await its response.
   * Rejects with a clear message if no extension is connected.
   */
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error(
          "No browser connected. Open the aux4 browser extension and click Connect."
        ));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Extension did not respond to "${method}" in time`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  stop() {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error("bridge stopped"));
    }
    this.pending.clear();
    if (this.socket) { try { this.socket.close(); } catch {} }
    if (this.wss) { try { this.wss.close(); } catch {} }
  }
}

const SOCKET_DIR$2 = path.join(os.homedir(), ".aux4.config", "browser");
const SOCKET_PATH$3 = path.join(SOCKET_DIR$2, "browser.sock");
const PID_PATH$2 = path.join(SOCKET_DIR$2, "browser.pid");

class DaemonServer {
  constructor(options = {}) {
    this.maxSessions = options.maxSessions || 20;
    this.persistent = options.persistent || false;
    this.channel = options.channel || "";
    this.browserName = options.browser || "";
    this.headed = options.headed || false;
    this.backend = options.backend || "playwright";
    this.wsPort = options.wsPort || 8765;
    this.token = options.token || "";
    this.sessionManager = null;
    this.server = null;
    this.browser = null;
    this.bridge = null;
  }

  async start() {
    fs.mkdirSync(SOCKET_DIR$2, { recursive: true });
    if (fs.existsSync(SOCKET_PATH$3)) fs.unlinkSync(SOCKET_PATH$3);

    if (this.backend === "extension") {
      // Attach to the user's own Chrome via the extension — no Playwright launch.
      this.bridge = new ExtensionBridge({ port: this.wsPort, token: this.token });
      await this.bridge.start();
      this.sessionManager = new ExtensionSessionManager(this.bridge, {
        maxSessions: this.maxSessions,
        onEmpty: () => {
          if (!this.persistent) this.stop();
        }
      });
    } else {
      // Defensive self-heal for when the daemon is launched directly (not via the
      // StartCommand parent, which already provisions the browser). No-op/quiet
      // when the browser is already present.
      ensureBrowserInstalled(this.browserName || "chromium");

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
    }

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

    this.server.listen(SOCKET_PATH$3);
    fs.writeFileSync(PID_PATH$2, process.pid.toString());

    process.on("SIGTERM", () => this.stop());
    process.on("SIGINT", () => this.stop());

    const started = { status: "started", socket: SOCKET_PATH$3, pid: process.pid, backend: this.backend };
    if (this.backend === "extension") started.wsPort = this.wsPort;
    console.log(JSON.stringify(started));
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
      case "fill": return this.sessionManager.fill(params.session, params);
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
    if (this.bridge) this.bridge.stop();
    if (this.browser) await this.browser.close();
    if (this.server) this.server.close();
    try { fs.unlinkSync(SOCKET_PATH$3); } catch {}
    try { fs.unlinkSync(PID_PATH$2); } catch {}
    if (!this.embedded) process.exit(0);
  }
}

const SOCKET_DIR$1 = path.join(os.homedir(), ".aux4.config", "browser");
const SOCKET_PATH$2 = path.join(SOCKET_DIR$1, "browser.sock");
const PID_PATH$1 = path.join(SOCKET_DIR$1, "browser.pid");

function isDaemonRunning() {
  try {
    const pid = parseInt(fs.readFileSync(PID_PATH$1, "utf-8").trim());
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitForSocket$1(maxAttempts = 30) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const tryConnect = () => {
      attempts++;
      const socket = net.createConnection(SOCKET_PATH$2);
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

  // Self-provision the browser binary in the foreground (before forking the
  // detached daemon) so the "installing…" notice is visible to the user and the
  // daemon child never blocks on a download while waitForSocket() is ticking.
  ensureBrowserInstalled(params.browser || "chromium");

  // Fork the daemon to the background
  const child = spawn(process.execPath, process.argv.slice(1), {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, AUX4_BROWSER_DAEMON: "1" }
  });
  child.unref();

  // Wait for the daemon socket to become available
  await waitForSocket$1();

  console.log(JSON.stringify({ status: "started", pid: child.pid }));
}

const SOCKET_DIR = path.join(os.homedir(), ".aux4.config", "browser");
const SOCKET_PATH$1 = path.join(SOCKET_DIR, "browser.sock");
const PID_PATH = path.join(SOCKET_DIR, "browser.pid");
const CONNECT_PATH = path.join(SOCKET_DIR, "connect.json");

const DEFAULT_WS_PORT = 8765;

function readConnectConfig() {
  return JSON.parse(fs.readFileSync(CONNECT_PATH, "utf-8"));
}

function daemonPid() {
  try {
    const pid = parseInt(fs.readFileSync(PID_PATH, "utf-8").trim());
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
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
        if (attempts >= maxAttempts) reject(new Error("Daemon failed to start"));
        else setTimeout(tryConnect, 500);
      });
    };
    tryConnect();
  });
}

async function waitForGone(pid, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    try { process.kill(pid, 0); } catch { return; }
    await new Promise(r => setTimeout(r, 250));
  }
}

async function ConnectCommand(params) {
  // Forked daemon child: read the paired config and start in extension mode.
  if (process.env.AUX4_BROWSER_DAEMON === "1") {
    const cfg = readConnectConfig();
    const server = new DaemonServer({
      backend: "extension",
      wsPort: cfg.port,
      token: cfg.token,
      persistent: true,
      maxSessions: 20
    });
    await server.start();
    return;
  }

  const port = parseInt(params.port) || DEFAULT_WS_PORT;

  // A running daemon (Playwright or a stale extension one) owns the single
  // socket -- replace it so `connect` always lands in extension mode.
  const existing = daemonPid();
  if (existing) {
    try { process.kill(existing, "SIGTERM"); } catch {}
    await waitForGone(existing);
  }

  fs.mkdirSync(SOCKET_DIR, { recursive: true });
  const token = crypto.randomBytes(24).toString("hex");
  fs.writeFileSync(CONNECT_PATH, JSON.stringify({ token, port }, null, 2), { mode: 0o600 });

  const child = spawn(process.execPath, process.argv.slice(1), {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, AUX4_BROWSER_DAEMON: "1" }
  });
  child.unref();

  await waitForSocket();

  console.log(JSON.stringify({
    status: "waiting-for-extension",
    wsUrl: `ws://127.0.0.1:${port}`,
    token,
    pid: child.pid,
    next: [
      "1. Install aux4 Browser Connector from https://github.com/aux4/browser-connector/releases or load its repository at chrome://extensions",
      "2. Click the aux4 Browser Connector icon",
      port === DEFAULT_WS_PORT
        ? `3. Paste this token and Connect: ${token}`
        : `3. Paste this token, tick "Use a custom port", enter ${port}, and Connect: ${token}`,
      "4. Run e.g. `aux4 browser snapshot --format text`"
    ]
  }, null, 2));
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
    waitUntil: params.waitUntil,
    new: params.new
  });
  // A refusal has no sessionId -- print the whole object so the reason and the session to
  // navigate are visible, instead of "undefined".
  if (result.status === "error" || result.snapshot) {
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

async function FillCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("fill", {
    session: params.session,
    field: params.field,
    timeout: params.timeout
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
      within: params.within,
      ref: params.ref
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
  if (result.status === "unsupported") {
    console.log(JSON.stringify(result));
  } else if (result.result !== undefined) {
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
    role: params.role,
    ref: params.ref
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
  connect:     { handler: ConnectCommand,  args: ["port"] },
  stop:        { handler: StopCommand,     args: [] },
  open:        { handler: OpenCommand,     args: ["url", "timeout", "width", "height", "output", "video", "snapshot", "waitUntil", "new"] },
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
  type:        { handler: TypeCommand,     args: ["session", "name", "value", "role", "within", "ref"] },
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
  fill:        { handler: FillCommand,     args: ["session", "field", "timeout"] },
  select:      { handler: SelectCommand,   args: ["session", "name", "value", "role", "ref"] },
  check:       { handler: CheckCommand,    args: ["session", "name", "role", "ref"] },
  uncheck:     { handler: UncheckCommand,  args: ["session", "name", "role", "ref"] },
  hover:       { handler: HoverCommand,    args: ["session", "name", "role", "ref"] },
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
