import { DaemonClient } from "../client/DaemonClient.js";

export async function CheckCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("check", {
    session: params.session,
    name: params.name,
    role: params.role,
    ref: params.ref,
    selector: params.selector,
    within: params.within
  });
  console.log(JSON.stringify(result));
}

export async function UncheckCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("uncheck", {
    session: params.session,
    name: params.name,
    role: params.role,
    ref: params.ref,
    selector: params.selector,
    within: params.within
  });
  console.log(JSON.stringify(result));
}
