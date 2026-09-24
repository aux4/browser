import { AgentCoreClient } from "../daemon/AgentCoreClient.js";

function client(params) {
  return new AgentCoreClient({ region: params.awsRegion || "us-east-1", profile: params.awsProfile || "" });
}

export async function AgentCoreStartCommand(params) {
  const result = await client(params).startSession({
    name: params.name,
    timeoutSeconds: params.timeoutSeconds,
    browserIdentifier: params.agentcoreBrowserId
  });
  console.log(JSON.stringify(result));
}

export async function AgentCoreStopCommand(params) {
  if (!params.sessionId) throw new Error("agentcore-stop: --sessionId is required");
  const result = await client(params).stopSession({
    sessionId: params.sessionId,
    browserIdentifier: params.agentcoreBrowserId
  });
  console.log(JSON.stringify(result));
}

export async function AgentCoreListCommand(params) {
  const result = await client(params).listSessions({ browserIdentifier: params.agentcoreBrowserId });
  console.log(JSON.stringify(result));
}
