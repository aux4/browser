import { DaemonClient } from "../client/DaemonClient.js";

export async function WaitCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("wait", {
    session: params.session,
    selector: params.selector,
    timeout: params.timeout
  });
  // No output on success
}
