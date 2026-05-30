import { DaemonClient } from "../client/DaemonClient.js";

export async function PressCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("press", {
    session: params.session,
    key: params.key,
    selector: params.selector
  });
  console.log(JSON.stringify(result));
}
