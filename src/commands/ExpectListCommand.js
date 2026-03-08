import { DaemonClient } from "../client/DaemonClient.js";

export async function ExpectListCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("expect-list", {
    session: params.session,
    assertion: params.assertion,
    expected: params.expected,
    selector: params.selector,
    timeout: params.timeout
  });
  // No output on success
}
