import { DaemonClient } from "../client/DaemonClient.js";

export async function SetScopeCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("set-scope", {
    session: params.session,
    selector: params.selector
  });
  console.log(JSON.stringify(result));
}

export async function ClearScopeCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("clear-scope", {
    session: params.session
  });
  console.log(JSON.stringify(result));
}
