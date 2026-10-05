#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node -e 'if(Number(process.versions.node.split(".")[0]) < 24) { console.error("Agentic Workspace requires Node.js 24 or newer."); process.exit(1); }'
npm ci
npm run check
