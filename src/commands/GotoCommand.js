import { DaemonClient } from "../client/DaemonClient.js";

export async function VisitCommand(params) {
  const client = new DaemonClient();
  await client.send("visit", { session: params.session, url: params.url });
}
