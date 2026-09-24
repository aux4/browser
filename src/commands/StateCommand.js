import { DaemonClient } from "../client/DaemonClient.js";

export async function StateSaveCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("state-save", {
    session: params.session,
    output: params.output
  });
  console.log(JSON.stringify(result));
}

export async function StateLoadCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("state-load", {
    session: params.session,
    file: params.file
  });
  console.log(JSON.stringify(result));
}
