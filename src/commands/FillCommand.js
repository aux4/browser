import { DaemonClient } from "../client/DaemonClient.js";

export async function FillCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("fill", {
    session: params.session,
    field: params.field,
    timeout: params.timeout
  });
  console.log(JSON.stringify(result));
}
