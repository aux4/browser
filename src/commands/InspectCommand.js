import { DaemonClient } from "../client/DaemonClient.js";

export async function InspectCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("inspect", {
    session: params.session
  });
  console.log(JSON.stringify(result));
}
