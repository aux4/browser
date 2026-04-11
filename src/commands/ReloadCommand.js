import { DaemonClient } from "../client/DaemonClient.js";

export async function ReloadCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("reload", { session: params.session });
  console.log(JSON.stringify(result));
}
