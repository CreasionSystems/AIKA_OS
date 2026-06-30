#!/bin/bash
# SessionStart hook: install dependencies so tests / typecheck / e2e work.
#
# Note: Electron's postinstall downloads its binary directly (bypassing the
# agent proxy), which fails in the Claude-on-the-web remote environment.
# There we skip that download and provision the binary via the proxy-aware
# curl path (scripts/fetch-electron.mjs). Locally, the standard install runs.
#
# Idempotent and non-interactive. Synchronous (no async) so deps are ready
# before the session begins.
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}"

if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  export ELECTRON_SKIP_BINARY_DOWNLOAD=1
  export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
  npm install
  # Provision the Electron binary only if it is missing (keeps reruns cheap).
  if [ ! -x node_modules/electron/dist/electron ]; then
    npm run provision:electron
  fi
else
  npm install
fi
