#!/usr/bin/env zsh
# Same as dev:lan, but sets NEXT_PUBLIC_APP_URL for this process only so phones /
# other PCs on Wi‑Fi get correct cookies and redirects (overrides localhost in .env).

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ip=$(zsh "${ROOT}/scripts/lan-ipv4-print.zsh" || true)
if [[ -z "${ip// }" ]]; then
  echo "dev:wifi:auto / dev:lan:auto: could not detect a Wi‑Fi/LAN IPv4. Set NEXT_PUBLIC_APP_URL manually, then run npm run dev:lan" >&2
  exit 1
fi

export NEXT_PUBLIC_APP_URL="http://${ip}:3040"

echo "AAELink dev (Wi‑Fi / same network, auto URL)"
echo "----------------------------------------------"
echo "NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}  (this session only)"
echo ""
echo "Open from this Mac or other devices on the same Wi‑Fi:"
echo "  http://${ip}:3040"
echo ""
echo "This Mac (Electron shell):"
echo "  npm run desktop:start:wifi   (alias: desktop:start:lan)"
echo ""
echo "Other PCs (installed desktop app, Windows example):"
echo "  AAELink.exe --url=http://${ip}:3040"
echo ""
echo "Other PCs (browser only): open the URL above."
echo ""
echo "macOS firewall: allow Node or Terminal if others cannot connect."
echo ""
echo "Listening on 0.0.0.0:3040 ..."
echo ""

exec npx next dev -p 3040 -H 0.0.0.0
