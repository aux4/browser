import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { DaemonServer } from "../daemon/server.js";
import { ensureBrowserInstalled } from "../daemon/BrowserInstaller.js";

const SOCKET_DIR = path.join(os.homedir(), ".aux4.config", "browser");
const SOCKET_PATH = path.join(SOCKET_DIR, "browser.sock");
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
      const socket = net.createConnection(SOCKET_PATH);
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

export async function StartCommand(params) {
  const agentcoreSessionId = params.agentcoreSessionId || "";
  const isAgentCore = agentcoreSessionId !== "";

  // If running as the forked daemon child, start server directly
  if (process.env.AUX4_BROWSER_DAEMON === "1") {
    const server = new DaemonServer({
      maxSessions: parseInt(params.maxSessions) || 20,
      persistent: params.persistent === "true" || params.persistent === true,
      channel: params.channel || "",
      browser: params.browser || "",
      headed: params.headed === "true" || params.headed === true,
      agentcore: isAgentCore ? {
        sessionId: agentcoreSessionId,
        region: params.awsRegion || "us-east-1",
        profile: params.awsProfile || "",
        browserIdentifier: params.agentcoreBrowserId || "aws.browser.v1"
      } : null
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
  // Not needed in agentcore mode — the browser is remote, nothing to install.
  if (!isAgentCore) ensureBrowserInstalled(params.browser || "chromium");

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
