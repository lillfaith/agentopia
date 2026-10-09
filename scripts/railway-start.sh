#!/bin/sh
# Railway start command (see railway.json): SaaS defaults, schema migrations, then the server.
# Works whether Railway runs it as root (volume owned by root) or as 'node'.
set -e
export AGENTOPIA_MODE="${AGENTOPIA_MODE:-saas}"
export AGENTOPIA_DATA_DIR="${AGENTOPIA_DATA_DIR:-/data}"
export AGENTOPIA_TRUST_PROXY="${AGENTOPIA_TRUST_PROXY:-true}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$AGENTOPIA_DATA_DIR"
  find "$AGENTOPIA_DATA_DIR" ! -user node -exec chown node:node {} + 2>/dev/null || true
  exec setpriv --reuid=node --regid=node --init-groups sh "$0"
fi
node_modules/.bin/tsx scripts/migrate.ts
exec node_modules/.bin/tsx server/index.ts
