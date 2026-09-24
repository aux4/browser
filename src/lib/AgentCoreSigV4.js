// Minimal SigV4 signer for the AgentCore Browser CDP WebSocket handshake (GET,
// empty body). Avoids pulling in @aws-sdk/signature-v4 — this is a spike, and
// the algorithm is small and stable (AWS SigV4, "bedrock-agentcore" service).
import crypto from "node:crypto";
import pkg from "@aws-sdk/credential-provider-node";
const { defaultProvider } = pkg;

function hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

function amzDate() {
  const d = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: d, dateStamp: d.slice(0, 8) };
}

// Signs a GET request (no query string, no body) for the given https-form URL
// and returns headers to attach to the CDP WebSocket handshake.
export async function signGetRequest({ url, service, region, profile }) {
  const creds = await defaultProvider({ profile })();
  const u = new URL(url);
  const host = u.host;
  const canonicalUri = u.pathname;
  const { amzDate: xAmzDate, dateStamp } = amzDate();

  const payloadHash = sha256Hex("");
  const headers = {
    host,
    "x-amz-date": xAmzDate,
    ...(creds.sessionToken ? { "x-amz-security-token": creds.sessionToken } : {})
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map(h => `${h}:${headers[h]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");

  const canonicalRequest = [
    "GET",
    canonicalUri,
    "", // no query string
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    xAmzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");

  const kDate = hmac(`AWS4${creds.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  const authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    Authorization: authorization,
    "X-Amz-Date": xAmzDate,
    ...(creds.sessionToken ? { "X-Amz-Security-Token": creds.sessionToken } : {})
  };
}
