import { DaemonClient } from "../client/DaemonClient.js";

export async function OpenCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("open", {
    url: params.url,
    timeout: params.timeout,
    width: params.width,
    height: params.height,
    output: params.output,
    video: params.video,
    snapshot: params.snapshot
  });
  if (result.snapshot) {
    console.log(JSON.stringify(result));
  } else {
    console.log(result.sessionId);
  }
}
