#!/bin/sh
# Production entrypoint. With Litestream configured, restore the database if
# the volume is empty (first boot or a fresh volume), then run the server
# under `litestream replicate -exec` so replication stops with the process.
# Without LITESTREAM_BUCKET (local docker, smoke test) run node directly.
set -eu

: "${DATA_DIR:=/data}"
mkdir -p "$DATA_DIR"

if [ -n "${LITESTREAM_BUCKET:-}" ]; then
  litestream restore -if-db-not-exists -if-replica-exists -config /app/litestream.yml "$DATA_DIR/app.db"
  exec litestream replicate -config /app/litestream.yml -exec "node src/server.js"
fi

echo "entrypoint: LITESTREAM_BUCKET not set, running without replication" >&2
exec node src/server.js
