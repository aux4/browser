import { DaemonClient } from "../client/DaemonClient.js";
import { resolveFieldArgs } from "../lib/FieldArgs.js";

export async function FillCommand(params) {
  const client = new DaemonClient();
  const { field, value, fields } = resolveFieldArgs(params);
  const result = await client.send("fill", {
    session: params.session,
    field,
    value,
    fields,
    within: params.within,
    timeout: params.timeout,
    wait: params.wait
  });
  console.log(JSON.stringify(result));
}
