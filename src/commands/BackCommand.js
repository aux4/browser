import { DaemonClient } from "../client/DaemonClient.js";

export async function BackCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("back", { session: params.session });
  console.log(JSON.stringify(result));
}
