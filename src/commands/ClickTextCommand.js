import { DaemonClient } from "../client/DaemonClient.js";

export async function ClickTextCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("click-text", {
    session: params.session,
    text: params.text,
    index: params.index,
    within: params.within
  });
  console.log(JSON.stringify(result));
}
