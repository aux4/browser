import { DaemonClient } from "../client/DaemonClient.js";

export async function ClickCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("click", {
    session: params.session,
    name: params.name,
    role: params.role
  });
  console.log(JSON.stringify(result));
}
