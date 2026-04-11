import { DaemonClient } from "../client/DaemonClient.js";

export async function HoverCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("hover", {
    session: params.session,
    name: params.name,
    role: params.role
  });
  console.log(JSON.stringify(result));
}
