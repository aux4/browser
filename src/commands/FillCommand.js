import { DaemonClient } from "../client/DaemonClient.js";

export async function FillCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("fill", {
    session: params.session,
    field: params.field,
    value: params.value,
    fields: params.fields,
    within: params.within,
    timeout: params.timeout,
    wait: params.wait
  });
  console.log(JSON.stringify(result));
}
