import { DaemonClient } from "../client/DaemonClient.js";

export async function BackCommand(params) {
  const client = new DaemonClient();
  await client.send("back", { session: params.session });
}
