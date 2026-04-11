import { DaemonClient } from "../client/DaemonClient.js";

export async function ScrollCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("scroll", {
    session: params.session,
    direction: params.direction,
    amount: params.amount
  });
  console.log(JSON.stringify(result));
}
