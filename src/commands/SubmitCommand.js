import { DaemonClient } from "../client/DaemonClient.js";

export async function SubmitCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("submit", {
    session: params.session,
    within: params.within,
    timeout: params.timeout,
    wait: params.wait
  });
  console.log(JSON.stringify(result));
}
