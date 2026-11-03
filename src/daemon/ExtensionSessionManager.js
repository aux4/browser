import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SnapshotBuilder } from "../lib/SnapshotBuilder.js";

const DEFAULT_TIMEOUT = 600000;

/**
 * Chrome-backed implementation of the browser session contract.
 *
 * The daemon owns logical sessions while the extension owns real Chrome tabs.
 * A session remembers the target tab returned by `open`; a window-scoped
 * `list`/`open` can therefore be followed by stable tab-scoped actions.
 */
export class ExtensionSessionManager {
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
