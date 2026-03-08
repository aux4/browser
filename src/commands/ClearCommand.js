import { DaemonClient } from "../client/DaemonClient.js";

export async function ClearCommand(params) {
  const client = new DaemonClient();
  await client.send("clear", {
    session: params.session,
    name: params.name,
    role: params.role
  });
}
