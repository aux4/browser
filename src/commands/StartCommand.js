import { DaemonServer } from "../daemon/server.js";

export async function StartCommand(params) {
  const server = new DaemonServer({
    maxSessions: parseInt(params.maxSessions) || 10,
    persistent: params.persistent === "true" || params.persistent === true,
    channel: params.channel || "",
    browser: params.browser || ""
  });
  await server.start();
}
