import { DaemonClient } from "../client/DaemonClient.js";

export async function UploadCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("upload", {
    session: params.session,
    name: params.name,
    file: params.file
  });
  console.log(JSON.stringify(result));
}
