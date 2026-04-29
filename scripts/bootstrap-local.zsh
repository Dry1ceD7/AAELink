#!/usr/bin/env zsh
# Start Compose dependencies and wait until Postgres accepts connections.
# Run from repo root: npm run bootstrap:local

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Starting Docker Compose (Postgres, MinIO, Stirling-PDF)…"
docker compose up -d

echo "Waiting for Postgres (aaelink @ 127.0.0.1:25432)…"
for i in {1..90}; do
  if docker compose exec -T postgres pg_isready -U aaelink -q 2>/dev/null; then
    echo "Postgres is ready."
    echo ""
    echo "Next:"
    echo "  1. npm ci   (if you have not installed Node deps)"
    echo "  2. Create the first admin (pick your own password):"
    echo "       AAELINK_SEED_ADMIN_PASSWORD='your-long-password' npm run seed:platform-admin"
    echo "  3. Sign in at http://localhost:3040 with user name adminaaelink or email adminaaelink@aae.co.th"
    echo "     (spelling: admin-a-a-e-link — two a's after admin)"
    echo "  4. npm run dev"
    exit 0
  fi
  sleep 1
done

echo "Postgres did not become ready within 90s." >&2
echo "Check: docker compose logs postgres" >&2
exit 1
