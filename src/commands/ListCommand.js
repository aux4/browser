import { DaemonClient } from "../client/DaemonClient.js";

export async function ListCommand() {
  const client = new DaemonClient();
  const result = await client.send("list");
  console.log(JSON.stringify(result));
}
