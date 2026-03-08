import { DaemonClient } from "../client/DaemonClient.js";

export async function UploadCommand(params) {
  const client = new DaemonClient();
  await client.send("upload", {
    session: params.session,
    name: params.name,
    file: params.file
  });
}
