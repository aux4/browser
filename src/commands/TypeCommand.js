import { DaemonClient } from "../client/DaemonClient.js";
import { resolveSecret } from "../lib/SecretResolver.js";

export async function TypeCommand(params) {
  const value = resolveSecret(params.value);
  const client = new DaemonClient();
  const result = await client.send("type", {
    session: params.session,
    name: params.name,
    value: value,
    role: params.role
  });
  // No output on success
}
