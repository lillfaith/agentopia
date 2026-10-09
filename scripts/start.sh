#!/bin/sh
# Container start command: apply schema migrations, then run the server.
# If started as root (e.g. a platform that skips the entrypoint, with a
# root-owned volume), make the data directory writable and re-run as 'node'.
set -e
DATA_DIR="${AGENTOPIA_DATA_DIR:-/data}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  find "$DATA_DIR" ! -user node -exec chown node:node {} + 2>/dev/null || true
  exec setpriv --reuid=node --regid=node --init-groups sh "$0" "$@"
fi
node_modules/.bin/tsx scripts/migrate.ts
exec node_modules/.bin/tsx server/index.ts
