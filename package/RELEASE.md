# Release notes

## Fixes

- **macOS installs no longer depend on Homebrew's chromium cask.** Homebrew disabled the
  `chromium` cask on 2026-09-01 because it fails the macOS Gatekeeper check, so installing
  this package on a Mac without chromium failed. The cask was never used: the daemon drives
  Playwright's own chromium, which downloads itself on the first `browser start` and is
  self-contained on macOS. The chromium system dependency now applies on Linux only, where
  the distro package still provides the shared libraries Playwright's chromium needs.
- **The package archive is platform-neutral.** The build no longer installs optional npm
  dependencies, so a package built on a Mac no longer carries the macOS-only
  `fsevents.node` binary.
