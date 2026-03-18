import path from "node:path";
import { DaemonClient } from "../client/DaemonClient.js";

export async function SavePdfCommand(params) {
  const client = new DaemonClient();
  const output = params.output ? path.resolve(params.output) : path.resolve("page.pdf");
  const result = await client.send("save-pdf", {
    session: params.session,
    output,
    format: params.format,
    printBackground: params.printBackground
  });
  console.log(result.path);
}
