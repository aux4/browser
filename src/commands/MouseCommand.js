import { DaemonClient } from "../client/DaemonClient.js";

export async function MouseCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("mouse", {
    session: params.session,
    action: params.action,
    x: params.x,
    y: params.y,
    steps: params.steps,
    selector: params.selector,
    within: params.within
  });
  console.log(JSON.stringify(result));
}
