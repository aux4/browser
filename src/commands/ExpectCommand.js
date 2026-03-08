import { DaemonClient } from "../client/DaemonClient.js";

export async function ExpectCommand(params) {
  const client = new DaemonClient();
  await client.send("expect", {
    session: params.session,
    selector: params.selector,
    assertion: params.assertion,
    expected: params.expected || "",
    timeout: params.timeout || "5000"
  });
}
