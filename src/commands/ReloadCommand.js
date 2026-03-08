import { DaemonClient } from "../client/DaemonClient.js";

export async function ReloadCommand(params) {
  const client = new DaemonClient();
  await client.send("reload", { session: params.session });
}
