# Release notes

## Fixes

- **The package archive is now platform-neutral.** The build installed the bundled Playwright with
  its optional dependencies, which on macOS includes `fsevents` and its native macOS binary
  (`fsevents.node`). A package built on a Mac therefore carried a macOS-only file and was rejected on
  Linux. Optional dependencies are now skipped (`npm install --omit=optional`); `fsevents` is only used
  for file watching, which browser automation does not need. No change in behavior.
