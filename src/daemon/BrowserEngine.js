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
}
