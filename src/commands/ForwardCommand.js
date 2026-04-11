import { DaemonClient } from "../client/DaemonClient.js";

export async function ForwardCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("forward", { session: params.session });
  console.log(JSON.stringify(result));
}
