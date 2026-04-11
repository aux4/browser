import { DaemonClient } from "../client/DaemonClient.js";

export async function VisitCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("visit", { session: params.session, url: params.url });
  console.log(JSON.stringify(result));
}
