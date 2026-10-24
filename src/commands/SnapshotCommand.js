import { DaemonClient } from "../client/DaemonClient.js";

export async function SnapshotCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("snapshot", {
    session: params.session,
    mode: params.mode,
    format: params.format,
    output: params.output,
    wait: params.wait
  });
  if (params.output) {
    console.log(JSON.stringify(result));
  } else if (params.format === "text" && result.text != null) {
    console.log(result.text);
  } else {
    console.log(JSON.stringify(result));
  }
}
