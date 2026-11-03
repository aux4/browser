import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";
import { DaemonServer } from "../daemon/server.js";

const SOCKET_DIR = path.join(os.homedir(), ".aux4.config", "browser");
const SOCKET_PATH = path.join(SOCKET_DIR, "browser.sock");
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
      const socket = net.createConnection(SOCKET_PATH);
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

export async function ConnectCommand(params) {
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
