import { DaemonClient } from "../client/DaemonClient.js";

export async function PressCommand(params) {
  const client = new DaemonClient();
  await client.send("press", {
    session: params.session,
    key: params.key
  });
}
