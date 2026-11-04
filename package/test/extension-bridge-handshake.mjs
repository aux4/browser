// Headless test harness for the ExtensionBridge pairing handshake.
//
// Starts a real ExtensionBridge on an OS-assigned free port (no Chrome, no
// daemon, no aux4 CLI) and drives it with a plain `ws` client, exercising
// the wire-level handshake rules: bad token, protocol version mismatch,
// non-hello first frame, a valid handshake, and connection replacement.
//
// Run directly with node from package/test: `node extension-bridge-handshake.mjs`
import WebSocket from "ws";
import { ExtensionBridge, PROTOCOL_VERSION } from "../../src/daemon/ExtensionBridge.js";

const TOKEN = "test-token-" + Math.random().toString(36).slice(2);

function connect(port) {
  return new WebSocket(`ws://127.0.0.1:${port}`);
}

function once(emitter, event) {
  return new Promise((resolve) => emitter.once(event, (...args) => resolve(args)));
}

async function main() {
  const bridge = new ExtensionBridge({ port: 0, token: TOKEN });
  await bridge.start();
  const port = bridge.wss.address().port;

  const results = [];

  // 1. Bad token -> error bad-token, then the socket is closed.
  {
    const ws = connect(port);
    await once(ws, "open");
    const closed = once(ws, "close");
    const message = once(ws, "message");
    ws.send(JSON.stringify({ type: "hello", token: "wrong-token", protocolVersion: PROTOCOL_VERSION }));
    const [raw] = await message;
    const msg = JSON.parse(raw.toString());
    await closed;
    results.push(`bad-token:${msg.type === "error" && msg.reason === "bad-token" ? "pass" : "fail:" + JSON.stringify(msg)}`);
  }

  // 2. Wrong protocolVersion -> error version-mismatch, then closed.
  {
    const ws = connect(port);
    await once(ws, "open");
    const closed = once(ws, "close");
    const message = once(ws, "message");
    ws.send(JSON.stringify({ type: "hello", token: TOKEN, protocolVersion: PROTOCOL_VERSION + 1 }));
    const [raw] = await message;
    const msg = JSON.parse(raw.toString());
    await closed;
    results.push(`version-mismatch:${msg.type === "error" && msg.reason === "version-mismatch" ? "pass" : "fail:" + JSON.stringify(msg)}`);
  }

  // 3. Non-hello first frame -> error expected-hello, then closed.
  {
    const ws = connect(port);
    await once(ws, "open");
    const closed = once(ws, "close");
    const message = once(ws, "message");
    ws.send(JSON.stringify({ type: "ping" }));
    const [raw] = await message;
    const msg = JSON.parse(raw.toString());
    await closed;
    results.push(`expected-hello:${msg.type === "error" && msg.reason === "expected-hello" ? "pass" : "fail:" + JSON.stringify(msg)}`);
  }

  // 4. Valid token + matching protocol version -> welcome, connection stays open.
  let firstWs;
  {
    firstWs = connect(port);
    await once(firstWs, "open");
    const message = once(firstWs, "message");
    firstWs.send(JSON.stringify({ type: "hello", token: TOKEN, protocolVersion: PROTOCOL_VERSION }));
    const [raw] = await message;
    const msg = JSON.parse(raw.toString());
    results.push(`welcome:${msg.type === "welcome" ? "pass" : "fail:" + JSON.stringify(msg)}`);
  }

  // 5. A second valid connection replaces the first: the first gets closed by
  //    the bridge, the second is welcomed, and the bridge now points at it.
  {
    const firstClosed = once(firstWs, "close");
    const secondWs = connect(port);
    await once(secondWs, "open");
    const message = once(secondWs, "message");
    secondWs.send(JSON.stringify({ type: "hello", token: TOKEN, protocolVersion: PROTOCOL_VERSION }));
    const [raw] = await message;
    const msg = JSON.parse(raw.toString());
    await firstClosed;
    const replaced = msg.type === "welcome" && bridge.isConnected() && firstWs.readyState === WebSocket.CLOSED;
    results.push(`replace:${replaced ? "pass" : "fail:" + JSON.stringify(msg)}`);
    secondWs.close();
  }

  bridge.stop();
  console.log(results.join("\n"));
  process.exit(0);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
