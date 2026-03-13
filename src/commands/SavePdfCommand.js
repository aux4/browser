import { DaemonClient } from "../client/DaemonClient.js";

export async function SavePdfCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("save-pdf", {
    session: params.session,
    output: params.output,
    format: params.format,
    printBackground: params.printBackground
  });
  console.log(result.path);
}
