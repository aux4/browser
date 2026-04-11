import { DaemonClient } from "../client/DaemonClient.js";

export async function StopCommand() {
  const client = new DaemonClient();
  const result = await client.send("stop");
  console.log(JSON.stringify(result));
}
