import { DaemonClient } from "../client/DaemonClient.js";

export async function ScreenshotCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("screenshot", {
    session: params.session,
    output: params.output,
    fullPage: params.fullPage
  });
  console.log(result.path);
}
