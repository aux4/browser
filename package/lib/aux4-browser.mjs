import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
      .replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*>/gi, "![$1]($2)")
      .replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>/gi, "![$2]($1)")
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

const SOCKET_DIR = path.join(os.homedir(), ".aux4.config", "browser");
const SOCKET_PATH$1 = path.join(SOCKET_DIR, "browser.sock");
const PID_PATH = path.join(SOCKET_DIR, "browser.pid");

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
    fs.mkdirSync(SOCKET_DIR, { recursive: true });
    if (fs.existsSync(SOCKET_PATH$1)) fs.unlinkSync(SOCKET_PATH$1);

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

    this.server.listen(SOCKET_PATH$1);
    fs.writeFileSync(PID_PATH, process.pid.toString());

    process.on("SIGTERM", () => this.stop());
    process.on("SIGINT", () => this.stop());

    console.log(JSON.stringify({ status: "started", socket: SOCKET_PATH$1, pid: process.pid }));
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
    try { fs.unlinkSync(SOCKET_PATH$1); } catch {}
    try { fs.unlinkSync(PID_PATH); } catch {}
    if (!this.embedded) process.exit(0);
  }
}

async function StartCommand(params) {
  const server = new DaemonServer({
    maxSessions: parseInt(params.maxSessions) || 10,
    persistent: params.persistent === "true" || params.persistent === true,
    channel: params.channel || "",
    browser: params.browser || ""
  });
  await server.start();
}

const SOCKET_PATH = path.join(os.homedir(), ".aux4.config", "browser", "browser.sock");

class DaemonClient {
  async send(method, params = {}) {
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
        if (e.code === "ENOENT" || e.code === "ECONNREFUSED") {
          reject(new Error("Browser daemon is not running. Start it with: aux4 browser start"));
        } else {
          reject(e);
        }
      });
    });
  }
}

async function StopCommand() {
  const client = new DaemonClient();
  await client.send("stop");
}

async function OpenCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("open", {
    url: params.url,
    timeout: params.timeout,
    width: params.width,
    height: params.height,
    output: params.output,
    video: params.video
  });
  console.log(result.sessionId);
}

async function CloseCommand(params) {
  const client = new DaemonClient();
  await client.send("close", { session: params.session });
}

async function ListCommand() {
  const client = new DaemonClient();
  const result = await client.send("list");
  console.log(JSON.stringify(result));
}

async function VisitCommand(params) {
  const client = new DaemonClient();
  await client.send("visit", { session: params.session, url: params.url });
}

async function BackCommand(params) {
  const client = new DaemonClient();
  await client.send("back", { session: params.session });
}

async function ForwardCommand(params) {
  const client = new DaemonClient();
  await client.send("forward", { session: params.session });
}

async function ReloadCommand(params) {
  const client = new DaemonClient();
  await client.send("reload", { session: params.session });
}

async function ClickCommand(params) {
  const client = new DaemonClient();
  await client.send("click", {
    session: params.session,
    name: params.name,
    role: params.role
  });
  // No output on success
}

async function ClickSelectorCommand(params) {
  const client = new DaemonClient();
  await client.send("click-selector", {
    session: params.session,
    selector: params.selector
  });
  // No output on success
}

async function ClickTextCommand(params) {
  const client = new DaemonClient();
  await client.send("click-text", {
    session: params.session,
    text: params.text
  });
  // No output on success
}

async function ClickItemCommand(params) {
  const client = new DaemonClient();
  await client.send("click-item", {
    session: params.session,
    item: params.item,
    selector: params.selector
  });
  // No output on success
}

async function ExpectListCommand(params) {
  const client = new DaemonClient();
  await client.send("expect-list", {
    session: params.session,
    assertion: params.assertion,
    expected: params.expected,
    selector: params.selector,
    timeout: params.timeout
  });
  // No output on success
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

  for (let i = 0; i < names.length; i++) {
    await client.send("type", {
      session: params.session,
      name: names[i],
      value: values[i],
      role: params.role
    });
  }
}

async function ScrollCommand(params) {
  const client = new DaemonClient();
  await client.send("scroll", {
    session: params.session,
    direction: params.direction,
    amount: params.amount
  });
  // No output on success
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
  const result = await client.send("screenshot", {
    session: params.session,
    output: params.output,
    fullPage: params.fullPage
  });
  console.log(result.path);
}

async function WaitCommand(params) {
  const client = new DaemonClient();
  await client.send("wait", {
    session: params.session,
    selector: params.selector,
    timeout: params.timeout
  });
  // No output on success
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
  await client.send("expect", {
    session: params.session,
    selector: params.selector,
    assertion: params.assertion,
    expected: params.expected || "",
    timeout: params.timeout || "5000"
  });
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
  const result = await client.send("download", {
    session: params.session,
    url: params.url,
    output: params.output
  });
  console.log(result.path);
}

async function SavePdfCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("save-pdf", {
    session: params.session,
    output: params.output,
    format: params.format,
    printBackground: params.printBackground
  });
  console.log(result.path);
}

async function NewTabCommand(params) {
  const client = new DaemonClient();
  await client.send("new-tab", {
    session: params.session,
    url: params.url
  });
}

async function SwitchTabCommand(params) {
  const client = new DaemonClient();
  await client.send("switch-tab", {
    session: params.session,
    tab: params.tab
  });
}

async function CloseTabCommand(params) {
  const client = new DaemonClient();
  await client.send("close-tab", {
    session: params.session,
    tab: params.tab
  });
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
  await client.send("select", {
    session: params.session,
    name: params.name,
    value: params.value,
    role: params.role
  });
}

async function CheckCommand(params) {
  const client = new DaemonClient();
  await client.send("check", {
    session: params.session,
    name: params.name,
    role: params.role
  });
}

async function UncheckCommand(params) {
  const client = new DaemonClient();
  await client.send("uncheck", {
    session: params.session,
    name: params.name,
    role: params.role
  });
}

async function HoverCommand(params) {
  const client = new DaemonClient();
  await client.send("hover", {
    session: params.session,
    name: params.name,
    role: params.role
  });
}

async function PressCommand(params) {
  const client = new DaemonClient();
  await client.send("press", {
    session: params.session,
    key: params.key
  });
}

async function ClearCommand(params) {
  const client = new DaemonClient();
  await client.send("clear", {
    session: params.session,
    name: params.name,
    role: params.role
  });
}

async function UploadCommand(params) {
  const client = new DaemonClient();
  await client.send("upload", {
    session: params.session,
    name: params.name,
    file: params.file
  });
}

async function SetScopeCommand(params) {
  const client = new DaemonClient();
  await client.send("set-scope", {
    session: params.session,
    selector: params.selector
  });
}

async function ClearScopeCommand(params) {
  const client = new DaemonClient();
  await client.send("clear-scope", {
    session: params.session
  });
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
  open:        { handler: OpenCommand,     args: ["url", "timeout", "width", "height", "output", "video"] },
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
    params[name] = values[i];
  }
});

try {
  await command.handler(params);
} catch (e) {
  console.error(JSON.stringify({ error: e.message }));
  process.exit(1);
}
