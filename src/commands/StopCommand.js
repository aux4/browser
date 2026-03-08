import { DaemonClient } from "../client/DaemonClient.js";

export async function StopCommand() {
  const client = new DaemonClient();
  await client.send("stop");
}
