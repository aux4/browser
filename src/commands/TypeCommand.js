import { DaemonClient } from "../client/DaemonClient.js";

export async function TypeCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("type", {
    session: params.session,
    name: params.name,
    value: params.value,
    role: params.role
  });
  // No output on success
}
