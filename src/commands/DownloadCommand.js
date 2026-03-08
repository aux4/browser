import { DaemonClient } from "../client/DaemonClient.js";

export async function DownloadCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("download", {
    session: params.session,
    url: params.url,
    output: params.output
  });
  console.log(result.path);
}
