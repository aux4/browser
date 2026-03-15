import { execSync } from "child_process";

export function resolveSecret(value) {
  return resolveSecrets([value])[0];
}

export function resolveSecrets(values) {
  const results = new Array(values.length);
  const groups = new Map();

  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (!value || !value.startsWith("secret://")) {
      results[i] = value;
      continue;
    }

    const path = value.replace("secret://", "");
    const parts = path.split("/");

    if (parts.length < 4) {
      throw new Error(`Invalid secret reference: ${value}. Expected format: secret://<provider>/<vault>/<item>/<field>`);
    }

    const provider = parts[0];
    const field = parts[parts.length - 1];
    const ref = parts.slice(1, parts.length - 1).join("/");
    const key = `${provider}:${ref}`;

    if (!groups.has(key)) {
      groups.set(key, { provider, ref, fields: [], indices: [] });
    }
    groups.get(key).fields.push(field);
    groups.get(key).indices.push(i);
  }

  for (const [, group] of groups) {
    const fields = group.fields.join(",");
    try {
      const output = execSync(
        `aux4 secret ${group.provider} get --ref "${group.ref}" --fields "${fields}"`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
      ).trim();

      const json = JSON.parse(output);
      for (let j = 0; j < group.fields.length; j++) {
        results[group.indices[j]] = json[group.fields[j]];
      }
    } catch (e) {
      if (e.status === 127) {
        throw new Error(`Secret provider 'aux4/secret-${group.provider}' is not installed. Install it with: aux4 aux4 pkger install aux4/secret-${group.provider}`);
      }
      throw new Error(`Failed to resolve secret: ${e.stderr ? e.stderr.trim() : e.message}`);
    }
  }

  return results;
}
