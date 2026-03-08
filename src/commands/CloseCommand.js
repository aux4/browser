import { DaemonClient } from "../client/DaemonClient.js";

export async function CloseCommand(params) {
  const client = new DaemonClient();
  await client.send("close", { session: params.session });
}
