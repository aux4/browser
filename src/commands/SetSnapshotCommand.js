import { DaemonClient } from "../client/DaemonClient.js";

export async function SetSnapshotCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("set-snapshot", {
    session: params.session,
    mode: params.mode
  });
  console.log(JSON.stringify(result));
}
