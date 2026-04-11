import { DaemonClient } from "../client/DaemonClient.js";

export async function ClickItemCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("click-item", {
    session: params.session,
    item: params.item,
    selector: params.selector
  });
  console.log(JSON.stringify(result));
}
