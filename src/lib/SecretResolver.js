import { execSync } from "child_process";

export function resolveSecret(value) {
  if (!value || !value.startsWith("secret://")) {
    return value;
  }

  const path = value.replace("secret://", "");
  const parts = path.split("/");

  if (parts.length < 4) {
    throw new Error(`Invalid secret reference: ${value}. Expected format: secret://<provider>/<vault>/<item>/<field>`);
  }

  const provider = parts[0];
  const field = parts[parts.length - 1];
  const ref = `secret://${parts.slice(0, parts.length - 1).join("/")}`;

  try {
    const output = execSync(
      `aux4 secret ${provider} get --ref "${ref}" --fields "${field}"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();

    const json = JSON.parse(output);
    return json[field];
  } catch (e) {
    if (e.status === 127) {
      throw new Error(`Secret provider 'aux4/secret-${provider}' is not installed. Install it with: aux4 aux4 pkger install aux4/secret-${provider}`);
    }
    throw new Error(`Failed to resolve secret: ${e.stderr ? e.stderr.trim() : e.message}`);
  }
}
