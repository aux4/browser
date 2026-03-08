import { DaemonClient } from "../client/DaemonClient.js";

export async function ContentCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("content", {
    session: params.session,
    selector: params.selector,
    format: params.format
  });
  console.log(result.content);
}
