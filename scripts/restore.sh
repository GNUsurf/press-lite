#!/bin/sh
# Restore the latest Litestream replica into a scratch file and verify it.
# Runs inside the production image (has litestream + node):
#
#   docker run --rm -e LITESTREAM_BUCKET=... -e LITESTREAM_ENDPOINT=... \
#     -e LITESTREAM_ACCESS_KEY_ID=... -e LITESTREAM_SECRET_ACCESS_KEY=... \
#     --entrypoint scripts/restore.sh <image>
#
# Exit code is non-zero if the restore fails or the database is not intact.
set -eu

OUT="${1:-/tmp/restore/app.db}"
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT" "$OUT-wal" "$OUT-shm"

# DATA_DIR only matters for the config file's db path; the replica is what we read.
export DATA_DIR="${DATA_DIR:-/data}"

echo "restore: pulling latest generation from replica"
litestream restore -config /app/litestream.yml -o "$OUT" "$DATA_DIR/app.db"

echo "restore: checking integrity"
node /app/scripts/integrity-check.js "$OUT"
