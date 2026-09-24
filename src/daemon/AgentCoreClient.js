// Thin wrapper around the Bedrock AgentCore Browser data-plane API (session
// lifecycle) plus the SigV4 signer needed to attach Playwright to the
// session's CDP automation stream. LOCAL SPIKE — package.json has no
// dependency on @aws-sdk/* yet; these are dev-only installs under
// package/lib/node_modules for this spike (see CBR-002/003).
import {
  BedrockAgentCoreClient,
  StartBrowserSessionCommand,
  StopBrowserSessionCommand,
  GetBrowserSessionCommand,
  ListBrowserSessionsCommand
} from "@aws-sdk/client-bedrock-agentcore";
import pkg from "@aws-sdk/credential-provider-node";
const { defaultProvider } = pkg;
import { signGetRequest } from "../lib/AgentCoreSigV4.js";

const DEFAULT_BROWSER_ID = "aws.browser.v1";
const SERVICE = "bedrock-agentcore";

export function wsUrl({ region, browserIdentifier, sessionId }) {
  return `wss://bedrock-agentcore.${region}.amazonaws.com/browser-streams/${browserIdentifier}/sessions/${sessionId}/automation`;
}

export class AgentCoreClient {
  constructor({ region, profile } = {}) {
    this.region = region || "us-east-1";
    this.profile = profile || "";
    this.client = new BedrockAgentCoreClient({
      region: this.region,
      ...(this.profile ? { credentials: defaultProvider({ profile: this.profile }) } : {})
    });
  }

  async startSession({ name, timeoutSeconds, browserIdentifier = DEFAULT_BROWSER_ID }) {
    const res = await this.client.send(new StartBrowserSessionCommand({
      browserIdentifier,
      name: name || "aux4-browser-agentcore",
      sessionTimeoutSeconds: timeoutSeconds ? parseInt(timeoutSeconds) : undefined
    }));
    return {
      sessionId: res.sessionId,
      browserIdentifier,
      region: this.region,
      createdAt: res.createdAt,
      wsUrl: wsUrl({ region: this.region, browserIdentifier, sessionId: res.sessionId })
    };
  }

  async stopSession({ sessionId, browserIdentifier = DEFAULT_BROWSER_ID }) {
    await this.client.send(new StopBrowserSessionCommand({ browserIdentifier, sessionId }));
    return { status: "stopped", sessionId };
  }

  async getSession({ sessionId, browserIdentifier = DEFAULT_BROWSER_ID }) {
    const res = await this.client.send(new GetBrowserSessionCommand({ browserIdentifier, sessionId }));
    return res;
  }

  async listSessions({ browserIdentifier = DEFAULT_BROWSER_ID } = {}) {
    const res = await this.client.send(new ListBrowserSessionsCommand({ browserIdentifier }));
    return res.items || [];
  }

  // Signed headers to hand to Playwright's connectOverCDP({ headers }) for the
  // automation stream WebSocket handshake (GET, no body).
  async signedConnectHeaders({ sessionId, browserIdentifier = DEFAULT_BROWSER_ID }) {
    const url = wsUrl({ region: this.region, browserIdentifier, sessionId });
    return signGetRequest({ url, service: SERVICE, region: this.region, profile: this.profile || undefined });
  }
}
