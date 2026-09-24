// Redaction helpers (CBR-015). Provider-backed session ids can be bearer
// credentials in disguise: the built-in "cdp" provider's id is literally
// "cdp:<base64url(wsUrl)>" — a short-lived (<=300s) presigned WebSocket URL
// with its auth in the query string (e.g. X-Amz-Signature). "<provider>:<token>"
// ids minted by a plugin (e.g. "agentcore:<token>") can likewise embed
// reattach material. None of that belongs in a status listing, a log line,
// or an error message: it does not help debug the failure, and every extra
// place it is printed is another place it can leak (shell history, CI logs,
// a ledger comment). Functional input handling is NOT affected — commands
// still accept the real, full session id via --session/--cdpUrl; only
// DISPLAY of a session's own identity in non-functional output is redacted.

// fingerprintSessionId("cdp:eyJhbGciOi...") -> "cdp:...a1b2c3"
// fingerprintSessionId("agentcore:eyJhbGciOi...") -> "agentcore:...a1b2c3"
// Plain local ids (no ":") are returned unchanged — they carry no secret.
export function fingerprintSessionId(id) {
  if (typeof id !== "string") return id;
  const idx = id.indexOf(":");
  if (idx < 0) return id;
  const provider = id.slice(0, idx);
  const token = id.slice(idx + 1);
  if (token.length <= 6) return `${provider}:...${token}`;
  return `${provider}:...${token.slice(-6)}`;
}

// Strips the query string (where SigV4 presigned auth lives — X-Amz-Signature,
// X-Amz-Credential, etc.) from any ws://, wss://, http:// or https:// URL
// found inside a message, and collapses any bare "<provider>:<token>"
// session id to its fingerprint. Used on every error message before it
// leaves the daemon (server.js) so a connectOverCDP failure, a decode
// failure, or any other error can never carry the presigned URL/signature
// or a full session token back to the caller/logs.
export function sanitizeMessage(message) {
  if (typeof message !== "string") return message;
  let out = message.replace(
    /\b(wss?|https?):\/\/[^\s"')]+/gi,
    (url) => url.split("?")[0] + (url.includes("?") ? "?<redacted>" : "")
  );
  out = out.replace(/\b(cdp|agentcore|[a-z0-9-]{2,20}):[A-Za-z0-9_\-.]{20,}\b/gi, (m) =>
    fingerprintSessionId(m)
  );
  return out;
}
