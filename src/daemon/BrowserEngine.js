import { createRequire } from "node:module";

let browsers;

function getBrowsers() {
  if (!browsers) {
    const require = createRequire(import.meta.url);
    const { chromium, firefox, webkit } = require("playwright");
    browsers = { chromium, firefox, webkit };
  }
  return browsers;
}

export class BrowserEngine {
  static async launch(options = {}) {
    const { channel, browser: browserName, headed, ...launchOptions } = options;
    const available = getBrowsers();
    const engine = available[browserName] || available.chromium;
    if (channel) launchOptions.channel = channel;
    // headed (visible) Chrome dramatically lowers bot-detection vs headless
    return engine.launch({ headless: !headed, ...launchOptions });
  }
}
