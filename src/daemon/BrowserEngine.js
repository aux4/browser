import { chromium, firefox, webkit } from "playwright";

const BROWSERS = { chromium, firefox, webkit };

export class BrowserEngine {
  static async launch(options = {}) {
    const { channel, browser: browserName, ...launchOptions } = options;
    const engine = BROWSERS[browserName] || chromium;
    if (channel) launchOptions.channel = channel;
    return engine.launch({ headless: true, ...launchOptions });
  }
}
