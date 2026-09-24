import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ContentExtractor } from "../lib/ContentExtractor.js";
import { SnapshotBuilder } from "../lib/SnapshotBuilder.js";
import { ComponentResolver } from "../lib/ComponentResolver.js";
import { BrowserEngine } from "./BrowserEngine.js";
import { ProviderBridge } from "./ProviderBridge.js";

import { ARTIFACTS_DIR } from "../lib/Paths.js";

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

export class SessionManager {
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
      for (const el of document.querySelectorAll("*")) {
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
    if (params.ref != null && params.ref !== "") {
      const element = await this._resolveRefElement(session, params.ref);
      await element.selectOption(params.value, { timeout: parseInt(params.timeout) || 5000 });
      await element.dispose();
      return this._attachSnapshot(session, { status: "ok" });
    }
    const base = this.getBase(session, params);
    const role = params.role || "combobox";
    await base.getByRole(role, { name: params.name }).selectOption(params.value, { timeout: parseInt(params.timeout) || 5000 });
    return this._attachSnapshot(session, { status: "ok" });
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
