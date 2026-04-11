import { DaemonClient } from "../client/DaemonClient.js";

export async function ComponentCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("component", {
    session: params.session,
    type: params.type,
    action: params.action,
    name: params.name,
    row: params.row,
    col: params.col,
    where: params.where,
    item: params.item,
    field: params.field,
    fields: params.fields,
    value: params.value,
    tab: params.tab,
    path: params.path,
    title: params.title,
    timeout: params.timeout
  });
  console.log(JSON.stringify(result));
}
