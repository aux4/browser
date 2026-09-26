import { DaemonClient } from "../client/DaemonClient.js";

export async function ActionsCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("actions", {
    session: params.session,
    within: params.within,
    includeNav: params.includeNav,
    page: params.page
  });
  delete result.status;
  console.log(JSON.stringify(result));
}
