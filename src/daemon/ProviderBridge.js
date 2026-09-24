// The provider seam: aux4/browser core knows nothing about any remote
// browser vendor (AWS Bedrock AgentCore, or any future provider). A
// "provider" is just a name: when it's not "local", core shells out to a
// sibling aux4 command named "<provider>-open" / "<provider>-attach" /
// "<provider>-close" that a plugin package (e.g. aux4/browser-agentcore)
// contributes into the SAME "browser" profile — exactly like
// aux4/classify-jev adds "jev-ask" alongside aux4/classify's "ask".
//
// Contract (plugin -> core), all JSON on stdout:
//   <provider>-open   params: whatever the user passed to `browser open`
//                      (e.g. awsProfile, awsRegion, timeout)
//                      returns: { token, wsUrl, headers }
//   <provider>-attach params: { token }
//                      returns: { wsUrl, headers }
//   <provider>-close  params: { token }
//                      returns: { status: "closed" }
//
// `token` is opaque to core — the provider decides what it needs to encode
// in order to reattach or stop the session later (region, session id,
// credentials profile, etc). Core only ever does
// `chromium.connectOverCDP(wsUrl, { headers })` with what the provider hands
// back (see BrowserEngine.connect). If the plugin isn't installed, or the
// provider call fails for any reason, this throws loudly — core never falls
// back to launching a local browser.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function buildArgs(provider, action, params = {}) {
  const args = ["browser", `${provider}-${action}`];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    args.push(`--${key}`, String(value));
  }
  return args;
}

async function runProviderCommand(provider, action, params) {
  const args = buildArgs(provider, action, params);
  let stdout;
  try {
    ({ stdout } = await execFileAsync("aux4", args, { maxBuffer: 10 * 1024 * 1024 }));
  } catch (e) {
    const detail = (e.stderr || e.message || "").toString().trim();
    throw new Error(`browser provider "${provider}" is unavailable or failed on ${action}: ${detail}`);
  }
  const lastLine = stdout.trim().split("\n").filter(Boolean).pop() || "";
  try {
    return JSON.parse(lastLine);
  } catch {
    throw new Error(`browser provider "${provider}" ${action} returned invalid JSON: ${stdout}`);
  }
}

export const ProviderBridge = {
  open: (provider, params) => runProviderCommand(provider, "open", params),
  attach: (provider, params) => runProviderCommand(provider, "attach", params),
  close: (provider, params) => runProviderCommand(provider, "close", params)
};
