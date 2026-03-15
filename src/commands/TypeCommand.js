import { DaemonClient } from "../client/DaemonClient.js";
import { resolveSecrets } from "../lib/SecretResolver.js";

export async function TypeCommand(params) {
  const names = Array.isArray(params.name) ? params.name : [params.name];
  const values = Array.isArray(params.value) ? params.value : [params.value];

  if (names.length !== values.length) {
    throw new Error(`Mismatched fields: ${names.length} name(s) but ${values.length} value(s)`);
  }

  const resolved = resolveSecrets(values);
  const client = new DaemonClient();

  for (let i = 0; i < names.length; i++) {
    await client.send("type", {
      session: params.session,
      name: names[i],
      value: resolved[i],
      role: params.role
    });
  }
}
