import { DaemonClient } from "../client/DaemonClient.js";

export async function BlocksCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("blocks", {
    session: params.session,
    url: params.url,
    waitUntil: params.waitUntil,
    maxBlockChars: params.maxBlockChars,
    includeNav: params.includeNav
  });
  console.log(JSON.stringify(result.blocks || []));
}
