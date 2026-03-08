import { DaemonClient } from "../client/DaemonClient.js";

export async function SelectCommand(params) {
  const client = new DaemonClient();
  await client.send("select", {
    session: params.session,
    name: params.name,
    value: params.value,
    role: params.role
  });
}
