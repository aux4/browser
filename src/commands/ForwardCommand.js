import { DaemonClient } from "../client/DaemonClient.js";

export async function ForwardCommand(params) {
  const client = new DaemonClient();
  await client.send("forward", { session: params.session });
}
