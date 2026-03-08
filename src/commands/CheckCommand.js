import { DaemonClient } from "../client/DaemonClient.js";

export async function CheckCommand(params) {
  const client = new DaemonClient();
  await client.send("check", {
    session: params.session,
    name: params.name,
    role: params.role
  });
}

export async function UncheckCommand(params) {
  const client = new DaemonClient();
  await client.send("uncheck", {
    session: params.session,
    name: params.name,
    role: params.role
  });
}
