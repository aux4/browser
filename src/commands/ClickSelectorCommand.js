import { DaemonClient } from "../client/DaemonClient.js";

export async function ClickSelectorCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("click-selector", {
    session: params.session,
    selector: params.selector,
    within: params.within
  });
  console.log(JSON.stringify(result));
}
