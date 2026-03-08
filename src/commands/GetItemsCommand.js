import { DaemonClient } from "../client/DaemonClient.js";

export async function GetItemsCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("get-items", {
    session: params.session,
    selector: params.selector
  });
  if (Array.isArray(result)) {
    result.forEach(item => console.log(item));
  }
}
