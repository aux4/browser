// User-agent policy for every session (local or provider-backed).
//
// Some browsers announce themselves as automation in the UA string:
//   - local headless Chromium:  "... HeadlessChrome/153.0.0.0 ..."
//   - Amazon Bedrock AgentCore: "... Chrome/148.0.0.0 Amazon-Bedrock-AgentCore-Browser/1.0
//                                 (Chromium; +https://docs.aws.amazon.com/...)"
// Bot-management edges (Imperva/Incapsula, Akamai, ...) key off those tokens
// and block the page's own API calls (403), so single-page apps render an
// empty shell (CBR-050: bcbsil's provider finder rendered 0 blocks in
// AgentCore; with the token stripped it renders fully from the same AWS IP).
//
// AUX4_BROWSER_USER_AGENT controls it:
//   unset / ""  -> normalize (strip the tokens above, keep everything else)
//   "keep"      -> leave the browser's own user agent untouched
//   any other   -> use that exact string as the user agent

const AUTOMATION_TOKENS = [
  // AgentCore's product token plus its "(Chromium; +https://...)" comment
  /\s*Amazon-Bedrock-AgentCore-Browser\/\S+(\s*\([^)]*\))?/g
];

export function normalizeUserAgent(userAgent) {
  if (!userAgent) return userAgent;
  let ua = String(userAgent);
  for (const pattern of AUTOMATION_TOKENS) ua = ua.replace(pattern, "");
  ua = ua.replace(/HeadlessChrome\//g, "Chrome/").replace(/\s{2,}/g, " ").trim();
  // a stock Chrome UA always ends with the Safari token; keep that shape
  if (/ Chrome\/\S+$/.test(ua)) ua += " Safari/537.36";
  return ua;
}

// Returns the user agent to apply given the browser's own UA, or null when
// nothing should change.
export function resolveUserAgent(browserUserAgent, setting = process.env.AUX4_BROWSER_USER_AGENT) {
  const mode = (setting || "").trim();
  if (mode.toLowerCase() === "keep") return null;
  if (mode) return mode === browserUserAgent ? null : mode;
  const normalized = normalizeUserAgent(browserUserAgent);
  return normalized && normalized !== browserUserAgent ? normalized : null;
}

// The browser's own user agent over CDP (Chromium only; null elsewhere).
export async function browserUserAgent(browser) {
  if (!browser || typeof browser.newBrowserCDPSession !== "function") return null;
  let cdp;
  try {
    cdp = await browser.newBrowserCDPSession();
    const { userAgent } = await cdp.send("Browser.getVersion");
    return userAgent || null;
  } catch {
    return null;
  } finally {
    if (cdp) await cdp.detach().catch(() => {});
  }
}

// Apply a user agent to every current and future page of a context that we
// don't own (a provider's default context): per-page CDP override, re-applied
// on reattach since overrides live as long as our connection.
export async function applyUserAgentToContext(context, userAgent) {
  if (!context || !userAgent) return;
  const apply = async (page) => {
    try {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.setUserAgentOverride", { userAgent });
    } catch {
      // page closed or target not CDP-capable; best-effort
    }
  };
  await Promise.all(context.pages().map(apply));
  context.on("page", apply);
}
