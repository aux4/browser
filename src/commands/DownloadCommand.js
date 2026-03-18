import path from "node:path";
import { DaemonClient } from "../client/DaemonClient.js";

export async function DownloadCommand(params) {
  const client = new DaemonClient();
  const output = params.output ? path.resolve(params.output) : undefined;
  const result = await client.send("download", {
    session: params.session,
    url: params.url,
    output
  });
  console.log(result.path);
}
