import { DaemonClient } from "../client/DaemonClient.js";

export async function SetScopeCommand(params) {
  const client = new DaemonClient();
  await client.send("set-scope", {
    session: params.session,
    selector: params.selector
  });
}

export async function ClearScopeCommand(params) {
  const client = new DaemonClient();
  await client.send("clear-scope", {
    session: params.session
  });
}
