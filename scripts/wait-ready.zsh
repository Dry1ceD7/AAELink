#!/usr/bin/env zsh
# AAELink (app) / Advanced ID Asia Engineering Co., Ltd. — wait until the HTTP API responds.
set -euo pipefail
cd "${0:a:h}/.."
url="${MM_SERVICESETTINGS_SITEURL:-http://localhost:8065}"
echo "AAELink (app) / Advanced ID Asia Engineering Co., Ltd."
echo "Waiting for AAELink at ${url} ..."
for i in {1..60}; do
  if curl -fsS "${url}/api/v4/system/ping" >/dev/null 2>&1; then
    echo "AAELink is up at ${url}."
    exit 0
  fi
  sleep 2
done
echo "Timed out." >&2
exit 1
