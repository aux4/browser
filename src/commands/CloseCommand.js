import { DaemonClient } from "../client/DaemonClient.js";

export async function CloseCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("close", { session: params.session });
  console.log(JSON.stringify(result));
}
