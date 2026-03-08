import { DaemonClient } from "../client/DaemonClient.js";

export async function ClickTextCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("click-text", {
    session: params.session,
    text: params.text
  });
  // No output on success
}
