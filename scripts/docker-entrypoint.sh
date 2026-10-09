#!/bin/sh
# Container entrypoint. Platforms such as Railway mount volumes owned by root, so
# the container starts as root only to make /data writable, then runs the actual
# command as the unprivileged 'node' user.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data
  find /data ! -user node -exec chown node:node {} + 2>/dev/null || true
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
