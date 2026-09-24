import { chromium, firefox, webkit } from "playwright";

const BROWSERS = { chromium, firefox, webkit };

export class BrowserEngine {
  static async launch(options = {}) {
    const { channel, browser: browserName, headed, ...launchOptions } = options;
    const engine = BROWSERS[browserName] || chromium;
    if (channel) launchOptions.channel = channel;
    // headed (visible) Chrome dramatically lowers bot-detection vs headless
    return engine.launch({ headless: !headed, ...launchOptions });
  }

  // Attach to a remote Chromium instance over CDP (e.g. an Amazon Bedrock
  // AgentCore Browser session) instead of launching a local process. The
  // default browser context/page belong to the remote session and are NOT
  // owned by this process — closing this Browser handle must not tear them
  // down (see SessionManager's "remote" mode).
  static async connect(wsUrl, headers = {}) {
    return chromium.connectOverCDP(wsUrl, { headers });
  }
}
