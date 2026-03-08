import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ContentExtractor } from "../lib/ContentExtractor.js";

export class SessionManager {
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
    if (params.url && params.url !== "") await page.goto(params.url);

    const session = {
      id, context, pages: [page], activeTab: 0,
      timeout, createdAt: Date.now(), lastActivity: Date.now(),
      timer: setTimeout(() => this.close(id), timeout),
      outputDir, videoMode, hadError: false
    };

    this.sessions.set(id, session);
    return { sessionId: id };
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
    await session.pages[session.activeTab].goto(url);
    return { status: "ok", url };
  }

  async back(sessionId) {
    const session = this.getSession(sessionId);
    const page = session.pages[session.activeTab];
    await page.goBack();
    return { status: "ok", url: page.url() };
  }

  async forward(sessionId) {
    const session = this.getSession(sessionId);
    const page = session.pages[session.activeTab];
    await page.goForward();
    return { status: "ok", url: page.url() };
  }

  async reload(sessionId) {
    const session = this.getSession(sessionId);
    const page = session.pages[session.activeTab];
    await page.reload();
    return { status: "ok", url: page.url() };
  }

  async click(sessionId, params) {
    const session = this.getSession(sessionId);
    const base = this.getBase(session);
    const role = params.role || "button";
    await base.getByRole(role, { name: params.name }).click({ timeout: parseInt(params.timeout) || 5000 });
    return { status: "ok" };
  }

  async clickSelector(sessionId, params) {
    const session = this.getSession(sessionId);
    const base = this.getBase(session);
    await base.locator(params.selector).first().click({ timeout: parseInt(params.timeout) || 5000 });
    return { status: "ok" };
  }

  async clickText(sessionId, params) {
    const session = this.getSession(sessionId);
    const base = this.getBase(session);
    await base.getByText(params.text, { exact: false }).first().click({ timeout: parseInt(params.timeout) || 5000 });
    return { status: "ok" };
  }

  async type(sessionId, params) {
    const session = this.getSession(sessionId);
    const base = this.getBase(session);
    const role = params.role || "textbox";
    await base.getByRole(role, { name: params.name }).fill(params.value);
    return { status: "ok" };
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
    return { status: "ok" };
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
    return { status: "ok" };
  }

  async check(sessionId, params) {
    const session = this.getSession(sessionId);
    const base = this.getBase(session);
    const role = params.role || "checkbox";
    await base.getByRole(role, { name: params.name }).check({ timeout: parseInt(params.timeout) || 5000 });
    return { status: "ok" };
  }

  async uncheck(sessionId, params) {
    const session = this.getSession(sessionId);
    const base = this.getBase(session);
    const role = params.role || "checkbox";
    await base.getByRole(role, { name: params.name }).uncheck({ timeout: parseInt(params.timeout) || 5000 });
    return { status: "ok" };
  }

  async hover(sessionId, params) {
    const session = this.getSession(sessionId);
    const base = this.getBase(session);
    const role = params.role || "button";
    await base.getByRole(role, { name: params.name }).hover({ timeout: parseInt(params.timeout) || 5000 });
    return { status: "ok" };
  }

  async press(sessionId, params) {
    const session = this.getSession(sessionId);
    const page = session.pages[session.activeTab];
    await page.keyboard.press(params.key);
    return { status: "ok" };
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

  async download(sessionId, params) {
    const session = this.getSession(sessionId);
    const page = session.pages[session.activeTab];
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.goto(params.url)
    ]);
    await download.saveAs(params.output);
    return { status: "ok", path: params.output };
  }

  async newTab(sessionId, url) {
    const session = this.getSession(sessionId);
    const page = await session.context.newPage();
    if (url && url !== "") await page.goto(url);
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
    return { status: "ok" };
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
