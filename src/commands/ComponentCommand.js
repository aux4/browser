import { DaemonClient } from "../client/DaemonClient.js";
import { resolveFieldArgs } from "../lib/FieldArgs.js";

export async function ComponentCommand(params) {
  const client = new DaemonClient();
  const { field, value, fields } = resolveFieldArgs(params);
  const result = await client.send("component", {
    session: params.session,
    type: params.type,
    action: params.action,
    name: params.name,
    row: params.row,
    col: params.col,
    where: params.where,
    item: params.item,
    field,
    fields,
    value,
    tab: params.tab,
    path: params.path,
    title: params.title,
    timeout: params.timeout,
    wait: params.wait
  });
  console.log(JSON.stringify(result));
}
