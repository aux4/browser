import path from "node:path";
import { DaemonClient } from "../client/DaemonClient.js";

export async function ScreenshotCommand(params) {
  const client = new DaemonClient();
  const output = params.output ? path.resolve(params.output) : path.resolve("screenshot.png");
  const result = await client.send("screenshot", {
    session: params.session,
    output,
    fullPage: params.fullPage
  });
  console.log(result.path);
}
