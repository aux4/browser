import { DaemonClient } from "../client/DaemonClient.js";

export async function EvalCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("eval", {
    session: params.session,
    script: params.script
  });
  if (result.result !== undefined) {
    console.log(typeof result.result === "string" ? result.result : JSON.stringify(result.result));
  }
}
