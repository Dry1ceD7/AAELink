#!/usr/bin/env zsh
# AAELink (app) / Advanced ID Asia Engineering Co., Ltd. — destructive stack reset (removes volumes).
set -euo pipefail
cd "${0:a:h}/.."
echo "Stopping AAELink stack and removing named volumes (Postgres + engine data for Advanced ID Asia Engineering Co., Ltd. deployment)..."
docker compose down -v --remove-orphans
echo "Pulling images..."
docker compose pull
echo "Starting fresh stack..."
docker compose up -d
echo "Done. Start Next (npm run dev) and open NEXT_PUBLIC_APP_URL from your .env (default http://localhost:3000)."
