import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { chromium, firefox, webkit } from "playwright";

const ENGINES = { chromium, firefox, webkit };

function normalizeBrowserName(browserName) {
  return ENGINES[browserName] ? browserName : "chromium";
}

/**
 * Returns true when Playwright's browser executable for the given engine is
 * present on disk. Never throws — a missing/uninstalled browser reports false.
 */
export function isBrowserInstalled(browserName = "chromium") {
  const engine = ENGINES[normalizeBrowserName(browserName)];
  try {
    const execPath = engine.executablePath();
    return Boolean(execPath) && fs.existsSync(execPath);
  } catch {
    // Newer Playwright throws from executablePath() when the browser is absent.
    return false;
  }
}

/**
 * Locates the bundled Playwright installer CLI. playwright-core/cli.js is the
 * real installer; playwright/cli.js is a thin re-export. The package "exports"
 * map blocks direct subpath resolution, so we resolve package.json (always
 * exported) and join cli.js next to it.
 */
function resolveInstallerCli() {
  const require = createRequire(import.meta.url);
  for (const pkg of ["playwright-core", "playwright"]) {
    try {
      const pkgJson = require.resolve(`${pkg}/package.json`);
      const cli = path.join(path.dirname(pkgJson), "cli.js");
      if (fs.existsSync(cli)) return cli;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * Ensures Playwright's browser binary is present, downloading it on first use
 * (the equivalent of `npx playwright install <browser>`). Idempotent and quiet
 * when already installed; prints a one-time notice to stderr while downloading.
 *
 * Only the browser BINARY is provisioned here — OS-level shared libraries are
 * declared in the package `.aux4` "system" field (Linux) and, for containers,
 * are best baked in with `playwright install-deps chromium` at image build.
 */
export function ensureBrowserInstalled(browserName = "chromium", log = defaultLog) {
  const name = normalizeBrowserName(browserName);

  if (isBrowserInstalled(name)) return { installed: false, browser: name };

  const cli = resolveInstallerCli();
  if (!cli) {
    throw new Error(
      `Playwright ${name} is not installed and the Playwright installer could not be located. ` +
        `Install it manually with: npx playwright install ${name}`
    );
  }

  log(`browser: ${name} runtime not found — installing it now (one-time, this may take a minute)...`);
  // Route the installer's download progress (fd 1) to our stderr (fd 2) so a
  // caller parsing this process's stdout (e.g. the {"status":"started"} line)
  // never sees the progress bars.
  const result = spawnSync(process.execPath, [cli, "install", name], {
    stdio: ["ignore", 2, 2],
    env: process.env
  });

  if (result.error || result.status !== 0) {
    const detail = result.error ? result.error.message : `exit code ${result.status}`;
    throw new Error(
      `Failed to install Playwright ${name} (${detail}). ` +
        `Install it manually with: npx playwright install ${name}`
    );
  }

  log(`browser: ${name} installed.`);
  return { installed: true, browser: name };
}

function defaultLog(message) {
  process.stderr.write(message + "\n");
}
