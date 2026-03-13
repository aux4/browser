import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SessionManager } from "./SessionManager.js";
import { BrowserEngine } from "./BrowserEngine.js";

const SOCKET_DIR = path.join(os.homedir(), ".aux4.config", "browser");
const SOCKET_PATH = path.join(SOCKET_DIR, "browser.sock");
const PID_PATH = path.join(SOCKET_DIR, "browser.pid");

export class DaemonServer {
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
    if (fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH);

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
    try { fs.unlinkSync(SOCKET_PATH); } catch {}
    try { fs.unlinkSync(PID_PATH); } catch {}
    if (!this.embedded) process.exit(0);
  }
}
