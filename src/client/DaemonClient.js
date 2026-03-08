import net from "node:net";
import path from "node:path";
import os from "node:os";

const SOCKET_PATH = path.join(os.homedir(), ".aux4.config", "browser", "browser.sock");

export class DaemonClient {
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
