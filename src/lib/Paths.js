// Where the daemon keeps its socket, pid file and artifacts.
//
// Default: ~/.aux4.config/browser. Override with AUX4_BROWSER_DIR. When the
// home directory is not writable (e.g. a read-only serverless/container
// filesystem where only the temp dir is writable), fall back to
// <tmpdir>/aux4-browser so the daemon can still create its unix socket.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function isWritableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveBrowserDir() {
  if (process.env.AUX4_BROWSER_DIR) return process.env.AUX4_BROWSER_DIR;
  const homeDir = path.join(os.homedir(), ".aux4.config", "browser");
  if (isWritableDir(homeDir)) return homeDir;
  return path.join(os.tmpdir(), "aux4-browser");
}

export const BROWSER_DIR = resolveBrowserDir();
export const SOCKET_PATH = path.join(BROWSER_DIR, "browser.sock");
export const PID_PATH = path.join(BROWSER_DIR, "browser.pid");
export const ARTIFACTS_DIR = path.join(BROWSER_DIR, "artifacts");
