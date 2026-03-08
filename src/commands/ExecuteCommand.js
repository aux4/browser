import { execSync } from "node:child_process";

export async function ExecuteCommand(params) {
  if (!params.instructions) {
    throw new Error("Missing --instructions parameter");
  }

  const args = ["playbook", "execute", params.instructions];
  if (params.session) args.push("--session", params.session);

  const output = execSync(`aux4 ${args.join(" ")}`).toString().trim();
  if (output) {
    console.log(output);
  }
}
