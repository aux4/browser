import net from "node:net";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

import { SOCKET_PATH } from "../lib/Paths.js";

export class DaemonClient {
  async send(method, params = {}) {
    try {
      return await this._connect(method, params);
    } catch (e) {
      if (e.code === "ENOENT" || e.code === "ECONNREFUSED" || e.message?.includes("not running")) {
        await this._autoStart(this._needsLocalBrowser(method, params));
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

  // A request on a provider-backed session ("<provider>:<token>") or an
  // `open --provider <remote>` never needs the local browser, so the
  // auto-started daemon skips provisioning/launching it (it is still
  // launched lazily if a local session is opened later).
  _needsLocalBrowser(method, params = {}) {
    if (method === "open") return !params.provider || params.provider === "local";
    if (typeof params.session === "string" && params.session.includes(":")) return false;
    return true;
  }

  async _autoStart(needsLocalBrowser = true) {
    const args = ["browser", "start"];
    if (!needsLocalBrowser) args.push("--localBrowser", "false");
    const child = spawn("aux4", args, {
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
