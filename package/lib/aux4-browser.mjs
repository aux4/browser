import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { webkit, firefox, chromium } from 'playwright';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

class ContentExtractor {
  static async extract(page, options = {}) {
    const { selector, format = "markdown" } = options;
    const element = selector && selector !== "" ? await page.$(selector) : await page.$("body");
    if (!element) return { content: "" };

    switch (format) {
      case "html":
        return { content: await element.innerHTML() };
      case "text":
        return { content: (await element.textContent()).trim() };
      case "markdown":
      default:
        const html = await element.innerHTML();
        return { content: ContentExtractor.htmlToMarkdown(html) };
    }
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

class SessionManager {
  constructor(browser, options = {}) {
    this.browser = browser;
    this.sessions = new Map();
    this.maxSessions = options.maxSessions || 10;
    this.onEmpty = options.onEmpty || (() => {});
  }

  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    this.resetTimer(session);
    return session;
  }

  getBase(session) {
    const page = session.pages[session.activeTab];
    return session.scope ? page.locator(session.scope) : page;
  }

  setScope(sessionId, selector) {
    const session = this.getSession(sessionId);
    if (!session.scopeStack) session.scopeStack = [];
    if (session.scope) session.scopeStack.push(session.scope);
    session.scope = selector;
    return { status: "ok", scope: selector };
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
    if (params.url && params.url !== "") await page.goto(params.url, { waitUntil: "networkidle" });

    const snapshotMode = params.snapshot || "off";
    const session = {
      id, context, pages: [page], activeTab: 0,
      timeout, createdAt: Date.now(), lastActivity: Date.now(),
      timer: setTimeout(() => this.close(id), timeout),
      outputDir, videoMode, hadError: false, snapshotMode
    };

    this.sessions.set(id, session);
    const result = { sessionId: id };
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

  async visit(sessionId, url) {
    const session = this.getSession(sessionId);
    await session.pages[session.activeTab].goto(url, { waitUntil: "networkidle" });
    return this._attachSnapshot(session, { status: "ok", url });
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

  async click(sessionId, params) {
    const session = this.getSession(sessionId);
    const base = this.getBase(session);
    const role = params.role || "button";
    await base.getByRole(role, { name: params.name }).click({ timeout: parseInt(params.timeout) || 5000 });
    return this._attachSnapshot(session, { status: "ok" });
  }

  async clickSelector(sessionId, params) {
    const session = this.getSession(sessionId);
    const base = this.getBase(session);
    await base.locator(params.selector).first().click({ timeout: parseInt(params.timeout) || 5000 });
    return this._attachSnapshot(session, { status: "ok" });
  }

  async clickText(sessionId, params) {
    const session = this.getSession(sessionId);
    const base = this.getBase(session);
    await base.getByText(params.text, { exact: false }).first().click({ timeout: parseInt(params.timeout) || 5000 });
    return this._attachSnapshot(session, { status: "ok" });
  }

  async type(sessionId, params) {
    const session = this.getSession(sessionId);
    const base = this.getBase(session);
    const role = params.role || "textbox";
    await base.getByRole(role, { name: params.name }).fill(params.value);
    return this._attachSnapshot(session, { status: "ok" });
  }

  async scroll(sessionId, params) {
    const session = this.getSession(sessionId);
    const page = session.pages[session.activeTab];
    if (params.direction === "top") {
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
    return ContentExtractor.extract(page, params);
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
    const base = this.getBase(session);
    const timeout = parseInt(params.timeout) || 5000;
    await base.locator(params.selector).first().waitFor({ state: "visible", timeout });
    return { status: "ok" };
  }

  async expect(sessionId, params) {
    const session = this.getSession(sessionId);
    const page = session.pages[session.activeTab];
    const base = this.getBase(session);
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
    const base = this.getBase(session);
    const role = params.role || "combobox";
    await base.getByRole(role, { name: params.name }).selectOption(params.value, { timeout: parseInt(params.timeout) || 5000 });
    return this._attachSnapshot(session, { status: "ok" });
  }

  async check(sessionId, params) {
    const session = this.getSession(sessionId);
    const base = this.getBase(session);
    const role = params.role || "checkbox";
    await base.getByRole(role, { name: params.name }).check({ timeout: parseInt(params.timeout) || 5000 });
    return this._attachSnapshot(session, { status: "ok" });
  }

  async uncheck(sessionId, params) {
    const session = this.getSession(sessionId);
    const base = this.getBase(session);
    const role = params.role || "checkbox";
    await base.getByRole(role, { name: params.name }).uncheck({ timeout: parseInt(params.timeout) || 5000 });
    return this._attachSnapshot(session, { status: "ok" });
  }

  async hover(sessionId, params) {
    const session = this.getSession(sessionId);
    const base = this.getBase(session);
    const role = params.role || "button";
    await base.getByRole(role, { name: params.name }).hover({ timeout: parseInt(params.timeout) || 5000 });
    return this._attachSnapshot(session, { status: "ok" });
  }

  async press(sessionId, params) {
    const session = this.getSession(sessionId);
    const page = session.pages[session.activeTab];
    await page.keyboard.press(params.key);
    return this._attachSnapshot(session, { status: "ok" });
  }

  async clear(sessionId, params) {
    const session = this.getSession(sessionId);
    const base = this.getBase(session);
    const role = params.role || "textbox";
    await base.getByRole(role, { name: params.name }).clear({ timeout: parseInt(params.timeout) || 5000 });
    return { status: "ok" };
  }

  async upload(sessionId, params) {
    const session = this.getSession(sessionId);
    const base = this.getBase(session);
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
    if (url && url !== "") await page.goto(url, { waitUntil: "networkidle" });
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
    const base = this.getBase(session);
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
    const base = this.getBase(session);
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
    const base = this.getBase(session);
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
    const base = this.getBase(session);
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
      case "visit": return this.visit(sessionId, params.url);
      case "back": return this.back(sessionId);
      case "forward": return this.forward(sessionId);
      case "reload": return this.reload(sessionId);
      case "click": return this.click(sessionId, params);
      case "click-selector": return this.clickSelector(sessionId, params);
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
    const { channel, browser: browserName, ...launchOptions } = options;
    const engine = BROWSERS[browserName] || chromium;
    if (channel) launchOptions.channel = channel;
    return engine.launch({ headless: true, ...launchOptions });
  }
}

const SOCKET_DIR$1 = path.join(os.homedir(), ".aux4.config", "browser");
const SOCKET_PATH$2 = path.join(SOCKET_DIR$1, "browser.sock");
const PID_PATH$1 = path.join(SOCKET_DIR$1, "browser.pid");

class DaemonServer {
  constructor(options = {}) {
    this.maxSessions = options.maxSessions || 10;
    this.persistent = options.persistent || false;
    this.channel = options.channel || "";
    this.browserName = options.browser || "";
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
      const error = { message: e.message };
      if (screenshot) error.screenshot = screenshot;
      socket.write(JSON.stringify({ error, id: request.id }) + "\n");
    }
  }

  async handleRequest(request) {
    const { method, params = {} } = request;

    switch (method) {
      case "open": return this.sessionManager.open(params);
      case "close": return this.sessionManager.close(params.session);
      case "list": return this.sessionManager.list();
      case "visit": return this.sessionManager.visit(params.session, params.url);
      case "back": return this.sessionManager.back(params.session);
      case "forward": return this.sessionManager.forward(params.session);
      case "reload": return this.sessionManager.reload(params.session);
      case "click": return this.sessionManager.click(params.session, params);
      case "click-selector": return this.sessionManager.clickSelector(params.session, params);
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
      maxSessions: parseInt(params.maxSessions) || 10,
      persistent: params.persistent === "true" || params.persistent === true,
      channel: params.channel || "",
      browser: params.browser || ""
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
    snapshot: params.snapshot
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
  const result = await client.send("visit", { session: params.session, url: params.url });
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
    role: params.role
  });
  console.log(JSON.stringify(result));
}

async function ClickSelectorCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("click-selector", {
    session: params.session,
    selector: params.selector
  });
  console.log(JSON.stringify(result));
}

async function ClickTextCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("click-text", {
    session: params.session,
    text: params.text
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
      role: params.role
    });
  }
  console.log(JSON.stringify(result));
}

async function ScrollCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("scroll", {
    session: params.session,
    direction: params.direction,
    amount: params.amount
  });
  console.log(JSON.stringify(result));
}

async function ContentCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("content", {
    session: params.session,
    selector: params.selector,
    format: params.format
  });
  console.log(result.content);
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
    key: params.key
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
    format: params.format
  });
  if (params.format === "text" && result.text != null) {
    console.log(result.text);
  } else {
    console.log(JSON.stringify(result));
  }
}

async function McpCommand() {
  const browser = await BrowserEngine.launch();
  const sessionManager = new SessionManager(browser, { maxSessions: 10 });

  const server = new McpServer({ name: "aux4-browser", version: "1.0.0" });

  const ok = (result) => ({ content: [{ type: "text", text: JSON.stringify(result) }] });

  server.tool("open", "Open a new browser session", {
    url: z.string().optional().describe("URL to navigate to"),
    timeout: z.string().optional().describe("Session timeout (e.g. 10m, 1h)"),
    width: z.number().optional().describe("Viewport width"),
    height: z.number().optional().describe("Viewport height")
  }, async (params) => ok(await sessionManager.open(params)));

  server.tool("close", "Close a browser session", {
    session: z.string().describe("Session ID")
  }, async (params) => ok(await sessionManager.close(params.session)));

  server.tool("list", "List active browser sessions", {}, async () => ok(sessionManager.list()));

  server.tool("visit", "Navigate to a URL", {
    session: z.string().describe("Session ID"),
    url: z.string().describe("URL to navigate to")
  }, async (params) => ok(await sessionManager.visit(params.session, params.url)));

  server.tool("back", "Go back in browser history", {
    session: z.string().describe("Session ID")
  }, async (params) => ok(await sessionManager.back(params.session)));

  server.tool("forward", "Go forward in browser history", {
    session: z.string().describe("Session ID")
  }, async (params) => ok(await sessionManager.forward(params.session)));

  server.tool("reload", "Reload the current page", {
    session: z.string().describe("Session ID")
  }, async (params) => ok(await sessionManager.reload(params.session)));

  server.tool("click", "Click an element by role and name", {
    session: z.string().describe("Session ID"),
    name: z.string().describe("Accessible name of the element"),
    role: z.string().optional().describe("ARIA role (default: button)")
  }, async (params) => ok(await sessionManager.click(params.session, params)));

  server.tool("click-selector", "Click an element by CSS selector", {
    session: z.string().describe("Session ID"),
    selector: z.string().describe("CSS selector")
  }, async (params) => ok(await sessionManager.clickSelector(params.session, params)));

  server.tool("click-text", "Click an element by its text content", {
    session: z.string().describe("Session ID"),
    text: z.string().describe("Text content to find and click")
  }, async (params) => ok(await sessionManager.clickText(params.session, params)));

  server.tool("click-item", "Click an item in a list by index or text", {
    session: z.string().describe("Session ID"),
    item: z.string().describe("Item index (1-based) or text to match"),
    selector: z.string().optional().describe("CSS selector for the list container")
  }, async (params) => ok(await sessionManager.clickItem(params.session, params)));

  server.tool("type", "Type text into an input field", {
    session: z.string().describe("Session ID"),
    name: z.string().describe("Accessible name of the field"),
    value: z.string().describe("Text to type"),
    role: z.string().optional().describe("ARIA role (default: textbox)")
  }, async (params) => ok(await sessionManager.type(params.session, params)));

  server.tool("select", "Select an option from a dropdown", {
    session: z.string().describe("Session ID"),
    name: z.string().describe("Accessible name of the dropdown"),
    value: z.string().describe("Option value to select"),
    role: z.string().optional().describe("ARIA role (default: combobox)")
  }, async (params) => ok(await sessionManager.select(params.session, params)));

  server.tool("check", "Check a checkbox", {
    session: z.string().describe("Session ID"),
    name: z.string().describe("Accessible name of the checkbox"),
    role: z.string().optional().describe("ARIA role (default: checkbox)")
  }, async (params) => ok(await sessionManager.check(params.session, params)));

  server.tool("uncheck", "Uncheck a checkbox", {
    session: z.string().describe("Session ID"),
    name: z.string().describe("Accessible name of the checkbox"),
    role: z.string().optional().describe("ARIA role (default: checkbox)")
  }, async (params) => ok(await sessionManager.uncheck(params.session, params)));

  server.tool("hover", "Hover over an element", {
    session: z.string().describe("Session ID"),
    name: z.string().describe("Accessible name of the element"),
    role: z.string().optional().describe("ARIA role (default: button)")
  }, async (params) => ok(await sessionManager.hover(params.session, params)));

  server.tool("press", "Press a keyboard key", {
    session: z.string().describe("Session ID"),
    key: z.string().describe("Key to press (e.g. Enter, Tab, Escape)")
  }, async (params) => ok(await sessionManager.press(params.session, params)));

  server.tool("clear", "Clear text from an input field", {
    session: z.string().describe("Session ID"),
    name: z.string().describe("Accessible name of the field"),
    role: z.string().optional().describe("ARIA role (default: textbox)")
  }, async (params) => ok(await sessionManager.clear(params.session, params)));

  server.tool("upload", "Upload a file to a file input", {
    session: z.string().describe("Session ID"),
    name: z.string().describe("Label of the file input"),
    file: z.string().describe("Path to the file to upload")
  }, async (params) => ok(await sessionManager.upload(params.session, params)));

  server.tool("scroll", "Scroll the page", {
    session: z.string().describe("Session ID"),
    direction: z.enum(["up", "down", "top", "bottom"]).optional().describe("Scroll direction (default: down)"),
    amount: z.number().optional().describe("Scroll amount in pixels (default: 500)")
  }, async (params) => ok(await sessionManager.scroll(params.session, params)));

  server.tool("content", "Get page content", {
    session: z.string().describe("Session ID"),
    selector: z.string().optional().describe("CSS selector (default: full page)"),
    format: z.enum(["markdown", "html", "text"]).optional().describe("Output format (default: markdown)")
  }, async (params) => ok(await sessionManager.content(params.session, params)));

  server.tool("screenshot", "Take a screenshot", {
    session: z.string().describe("Session ID"),
    output: z.string().optional().describe("Output file path"),
    fullPage: z.boolean().optional().describe("Capture full page")
  }, async (params) => ok(await sessionManager.screenshot(params.session, params)));

  server.tool("save-pdf", "Save the current page as PDF", {
    session: z.string().describe("Session ID"),
    output: z.string().optional().describe("Output file path (default: page.pdf)"),
    format: z.string().optional().describe("Page format (Letter, A4, Legal, Tabloid)"),
    printBackground: z.boolean().optional().describe("Print background graphics")
  }, async (params) => ok(await sessionManager.savePdf(params.session, params)));

  server.tool("wait", "Wait for a selector to appear", {
    session: z.string().describe("Session ID"),
    selector: z.string().describe("CSS selector to wait for"),
    timeout: z.number().optional().describe("Timeout in ms (default: 5000)")
  }, async (params) => ok(await sessionManager.wait(params.session, params)));

  server.tool("eval", "Evaluate JavaScript in the page", {
    session: z.string().describe("Session ID"),
    script: z.string().describe("JavaScript code to evaluate")
  }, async (params) => ok(await sessionManager.evaluate(params.session, params.script)));

  server.tool("expect", "Assert expectations on page elements", {
    session: z.string().describe("Session ID"),
    selector: z.string().describe("CSS selector"),
    assertion: z.enum(["have_text", "be_visible", "exist", "not_exist", "have_attribute", "have_count", "have_count_at_least", "have_url", "have_title"]).describe("Assertion type"),
    expected: z.string().optional().describe("Expected value (for have_text, have_attribute, have_count, have_url, have_title)"),
    timeout: z.string().optional().describe("Timeout in ms (default: 5000)")
  }, async (params) => ok(await sessionManager.expect(params.session, params)));

  server.tool("expect-list", "Assert expectations on a list of items", {
    session: z.string().describe("Session ID"),
    assertion: z.enum(["at_least", "contains"]).describe("Assertion type"),
    expected: z.string().describe("Expected value (count for at_least, text for contains)"),
    selector: z.string().optional().describe("CSS selector for the list container"),
    timeout: z.string().optional().describe("Timeout in ms (default: 10000)")
  }, async (params) => ok(await sessionManager.expectList(params.session, params)));

  server.tool("get-items", "Get text content of all items in a list", {
    session: z.string().describe("Session ID"),
    selector: z.string().optional().describe("CSS selector for the list container")
  }, async (params) => ok(await sessionManager.getItems(params.session, params)));

  server.tool("cookies", "Manage cookies", {
    session: z.string().describe("Session ID"),
    export: z.string().optional().describe("Export cookies to file"),
    import: z.string().optional().describe("Import cookies from file")
  }, async (params) => ok(await sessionManager.cookies(params.session, params)));

  server.tool("download", "Download a file", {
    session: z.string().describe("Session ID"),
    url: z.string().describe("URL to download"),
    output: z.string().describe("Output file path")
  }, async (params) => ok(await sessionManager.download(params.session, params)));

  server.tool("set-scope", "Restrict subsequent commands to elements within a CSS selector", {
    session: z.string().describe("Session ID"),
    selector: z.string().describe("CSS selector to scope to")
  }, async (params) => ok(sessionManager.setScope(params.session, params.selector)));

  server.tool("clear-scope", "Clear the current scope restriction", {
    session: z.string().describe("Session ID")
  }, async (params) => ok(sessionManager.clearScope(params.session)));

  server.tool("new-tab", "Open a new tab", {
    session: z.string().describe("Session ID"),
    url: z.string().optional().describe("URL to open in new tab")
  }, async (params) => ok(await sessionManager.newTab(params.session, params.url)));

  server.tool("switch-tab", "Switch to a tab", {
    session: z.string().describe("Session ID"),
    tab: z.number().describe("Tab index")
  }, async (params) => ok(await sessionManager.switchTab(params.session, params.tab)));

  server.tool("close-tab", "Close a tab", {
    session: z.string().describe("Session ID"),
    tab: z.number().describe("Tab index")
  }, async (params) => ok(await sessionManager.closeTab(params.session, params.tab)));

  server.tool("list-tabs", "List tabs in a session", {
    session: z.string().describe("Session ID")
  }, async (params) => ok(sessionManager.listTabs(params.session)));

  server.tool("execute", "Execute a batch of instructions", {
    session: z.string().describe("Session ID"),
    instructions: z.array(z.object({
      method: z.string(),
      params: z.record(z.string()).optional()
    })).describe("Array of {method, params} instructions")
  }, async (params) => ok(await sessionManager.execute(params.session, params.instructions)));

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const args = process.argv.slice(2);
const action = args[0];
const values = args.slice(1);

const commands = {
  start:       { handler: StartCommand,    args: ["maxSessions", "persistent", "channel", "browser"] },
  stop:        { handler: StopCommand,     args: [] },
  open:        { handler: OpenCommand,     args: ["url", "timeout", "width", "height", "output", "video", "snapshot"] },
  close:       { handler: CloseCommand,    args: ["session"] },
  list:        { handler: ListCommand,     args: [] },
  visit:       { handler: VisitCommand,    args: ["session", "url"] },
  back:        { handler: BackCommand,     args: ["session"] },
  forward:     { handler: ForwardCommand,  args: ["session"] },
  reload:      { handler: ReloadCommand,   args: ["session"] },
  click:       { handler: ClickCommand,    args: ["session", "name", "role"] },
  "click-selector": { handler: ClickSelectorCommand, args: ["session", "selector"] },
  "click-text": { handler: ClickTextCommand, args: ["session", "text"] },
  "click-item": { handler: ClickItemCommand, args: ["session", "item", "selector"] },
  type:        { handler: TypeCommand,     args: ["session", "name", "value", "role"] },
  scroll:      { handler: ScrollCommand,   args: ["session", "direction", "amount"] },
  content:     { handler: ContentCommand,  args: ["session", "selector", "format"] },
  screenshot:  { handler: ScreenshotCommand, args: ["session", "output", "fullPage"] },
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
  press:       { handler: PressCommand,    args: ["session", "key"] },
  clear:       { handler: ClearCommand,    args: ["session", "name", "role"] },
  upload:      { handler: UploadCommand,   args: ["session", "name", "file"] },
  "set-scope": { handler: SetScopeCommand, args: ["session", "selector"] },
  "clear-scope": { handler: ClearScopeCommand, args: ["session"] },
  component:   { handler: ComponentCommand, args: ["session", "type", "action", "name", "row", "col", "where", "item", "field", "fields", "value", "tab", "path", "title", "timeout"] },
  snapshot:    { handler: SnapshotCommand, args: ["session", "mode", "format"] },
  "new-tab":   { handler: NewTabCommand,   args: ["session", "url"] },
  "switch-tab": { handler: SwitchTabCommand, args: ["session", "tab"] },
  "close-tab": { handler: CloseTabCommand, args: ["session", "tab"] },
  "list-tabs": { handler: ListTabsCommand, args: ["session"] },
  mcp:         { handler: McpCommand,      args: [] }
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
