import crypto from "node:crypto";
import { WebSocketServer } from "ws";

export const PROTOCOL_VERSION = 1;
const REQUEST_TIMEOUT_MS = 30000;

/**
 * ExtensionBridge — the daemon side of the local aux4 ⇄ Chrome-extension link.
 *
 * MV3 extensions can only dial out, so the daemon is the WebSocket *server* and
 * the extension connects to it. The bridge owns:
 *   - the pairing handshake (token + protocol version),
   *   - a single active extension connection per Chrome profile,
 *   - request/response correlation by id, with timeouts.
 *
 * See https://github.com/aux4/browser-connector/blob/main/PROTOCOL.md for the wire contract.
 */
export class ExtensionBridge {
  constructor({ port = 8765, token }) {
    this.port = port;
    this.token = token;
    this.wss = null;
    this.socket = null;        // the one paired extension
    this.pending = new Map();  // id -> { resolve, reject, timer }
    this.nextId = 1;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ host: "127.0.0.1", port: this.port });
      this.wss.on("listening", () => {
        this.wss.on("connection", (ws) => this._onConnection(ws));
        resolve();
      });
      this.wss.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
          reject(new Error(
            `WebSocket port ${this.port} is already in use — is another ` +
            `\`aux4 browser connect\` running? Try \`aux4 browser stop\` or pass a different --port.`
          ));
        } else {
          reject(err);
        }
      });
    });
  }

  _onConnection(ws) {
    let paired = false;

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (!paired) {
        // First frame must be the handshake.
        if (msg.type !== "hello") {
          ws.send(JSON.stringify({ type: "error", reason: "expected-hello" }));
          ws.close();
          return;
        }
        if (!this._validToken(msg.token)) {
          ws.send(JSON.stringify({ type: "error", reason: "bad-token" }));
          ws.close();
          return;
        }
        if (msg.protocolVersion !== PROTOCOL_VERSION) {
          ws.send(JSON.stringify({
            type: "error",
            reason: "version-mismatch",
            expected: PROTOCOL_VERSION
          }));
          ws.close();
          return;
        }
        paired = true;
        // Replace any prior connection with the newest one.
        if (this.socket && this.socket !== ws) {
          try { this.socket.close(); } catch {}
        }
        this.socket = ws;
        ws.send(JSON.stringify({ type: "welcome", protocolVersion: PROTOCOL_VERSION }));
        return;
      }

      // Post-handshake: a response to a pending request.
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || "extension error"));
        else resolve(msg.result);
      }
    });

    ws.on("close", () => {
      if (this.socket === ws) {
        this.socket = null;
        for (const { reject, timer } of this.pending.values()) {
          clearTimeout(timer);
          reject(new Error("Chrome extension disconnected while the request was in flight"));
        }
        this.pending.clear();
      }
    });
    ws.on("error", () => {});
  }

  _validToken(token) {
    if (typeof token !== "string" || token.length !== this.token.length) return false;
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(this.token));
  }

  isConnected() {
    return this.socket != null && this.socket.readyState === 1;
  }

  /**
   * Send a method call to the paired extension and await its response.
   * Rejects with a clear message if no extension is connected.
   */
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error(
          "No browser connected. Open the aux4 browser extension and click Connect."
        ));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Extension did not respond to "${method}" in time`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  stop() {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error("bridge stopped"));
    }
    this.pending.clear();
    if (this.socket) { try { this.socket.close(); } catch {} }
    if (this.wss) { try { this.wss.close(); } catch {} }
  }
}
