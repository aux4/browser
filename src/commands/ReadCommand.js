import { DaemonClient } from "../client/DaemonClient.js";

export async function ReadCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("read", {
    url: params.url,
    session: params.session,
    format: params.format,
    waitUntil: params.waitUntil,
    output: params.output
  });
  console.log(JSON.stringify(result));
}
