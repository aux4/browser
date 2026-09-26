// User-agent policy for every session (local or provider-backed).
//
// Some browsers announce themselves as automation in the UA string:
//   - local headless Chromium:  "... HeadlessChrome/153.0.0.0 ..." (and a
//                                "HeadlessChrome" client-hint brand)
//   - Amazon Bedrock AgentCore: "... Chrome/148.0.0.0 Amazon-Bedrock-AgentCore-Browser/1.0
//                                 (Chromium; +https://docs.aws.amazon.com/...)"
// Bot-management edges (Imperva/Incapsula, Akamai, ...) key off those tokens
// and block the page's own API calls (403), so single-page apps render an
// empty shell (CBR-050: bcbsil's provider finder rendered 0 blocks in
// AgentCore; with the token stripped it renders from the same AWS IP).
//
// The override always carries user-agent client hints (Sec-CH-UA headers,
// navigator.userAgentData): a UA override without them drops the hints
// entirely, which is itself a strong automation signal.
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

// The browser's own user agent and product version over CDP (Chromium only;
// nulls elsewhere).
export async function browserVersion(browser) {
  if (!browser || typeof browser.newBrowserCDPSession !== "function") return { userAgent: null, product: null };
  let cdp;
  try {
    cdp = await browser.newBrowserCDPSession();
    const { userAgent, product } = await cdp.send("Browser.getVersion");
    return { userAgent: userAgent || null, product: product || null };
  } catch {
    return { userAgent: null, product: null };
  } finally {
    if (cdp) await cdp.detach().catch(() => {});
  }
}

export async function browserUserAgent(browser) {
  return (await browserVersion(browser)).userAgent;
}

const cleanBrand = (entry) => ({
  brand: /headless/i.test(entry.brand) ? "Chromium" : entry.brand,
  version: String(entry.version)
});

// Client-hint metadata matching `userAgent`. `live` is what the page itself
// reports (navigator.userAgentData, read before any override) when
// available; otherwise it is derived from the browser's product version.
export function userAgentMetadata(userAgent, product, live) {
  const fullVersion = ((product || "").match(/\/([\d.]+)/) || (userAgent || "").match(/Chrome\/([\d.]+)/) || [])[1] || "";
  const major = fullVersion.split(".")[0] || "";
  const platform = /Windows/.test(userAgent) ? "Windows"
    : /Mac OS X|Macintosh/.test(userAgent) ? "macOS"
      : /Android/.test(userAgent) ? "Android"
        : /CrOS/.test(userAgent) ? "Chrome OS" : "Linux";
  if (live && Array.isArray(live.brands) && live.brands.length) {
    return {
      brands: live.brands.map(cleanBrand),
      fullVersionList: (live.fullVersionList || []).map(cleanBrand),
      fullVersion: live.uaFullVersion || fullVersion,
      platform: live.platform || platform,
      platformVersion: live.platformVersion || "",
      architecture: live.architecture || "",
      model: live.model || "",
      mobile: !!live.mobile,
      bitness: live.bitness || "",
      wow64: !!live.wow64
    };
  }
  return {
    brands: [{ brand: "Not/A)Brand", version: "99" }, { brand: "Chromium", version: major }],
    fullVersionList: [{ brand: "Not/A)Brand", version: "99.0.0.0" }, { brand: "Chromium", version: fullVersion }],
    fullVersion,
    platform,
    platformVersion: "",
    architecture: /arm|aarch64/i.test(userAgent) ? "arm" : "x86",
    model: "",
    mobile: /Mobile/.test(userAgent),
    bitness: "64",
    wow64: false
  };
}

// What the page reports about itself (before any override), or null.
export async function readLiveMetadata(page) {
  try {
    return await page.evaluate(async () => {
      const d = navigator.userAgentData;
      if (!d) return null;
      const h = await d.getHighEntropyValues(["architecture", "bitness", "model", "platformVersion", "fullVersionList", "uaFullVersion", "wow64"]);
      return { brands: d.brands, mobile: d.mobile, platform: d.platform, ...h };
    });
  } catch {
    return null;
  }
}

// Apply a user agent (with client hints) to every current and future page of
// a context over CDP. Returns `ensure(page)` — idempotent, awaited before a
// navigation so a page created a moment ago can't race its first request
// ahead of the override. Overrides last as long as our connection, so a
// reattach applies them again.
export async function applyUserAgentToContext(context, userAgent, metadata) {
  if (!context || !userAgent) return async () => {};
  const done = new WeakMap();
  const ensure = (page) => {
    if (!page) return Promise.resolve();
    if (!done.has(page)) {
      done.set(page, (async () => {
        try {
          const cdp = await context.newCDPSession(page);
          const params = { userAgent };
          if (metadata) params.userAgentMetadata = metadata;
          await cdp.send("Network.setUserAgentOverride", params);
        } catch {
          // page closed or target not CDP-capable; best-effort
        }
      })());
    }
    return done.get(page);
  };
  await Promise.all(context.pages().map(ensure));
  context.on("page", ensure);
  return ensure;
}
