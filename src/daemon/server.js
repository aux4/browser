import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SessionManager } from "./SessionManager.js";
import { BrowserEngine } from "./BrowserEngine.js";
import { ensureBrowserInstalled } from "./BrowserInstaller.js";

import { BROWSER_DIR as SOCKET_DIR, SOCKET_PATH, PID_PATH } from "../lib/Paths.js";

export class DaemonServer {
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
    fs.mkdirSync(SOCKET_DIR, { recursive: true });
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
      const error = { message: this.truncateError(e.message) };
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
