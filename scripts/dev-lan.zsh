#!/usr/bin/env zsh
# Start Next dev bound to all interfaces so other devices on the same Wi‑Fi can reach the app.
# Set NEXT_PUBLIC_APP_URL to http://<this-machine-IPv4>:3040 in .env (or export before start)
# so sign-in cookies and redirects match the URL clients use.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ip=$(zsh "${ROOT}/scripts/lan-ipv4-print.zsh" || true)

echo "AAELink dev (same Wi‑Fi / network)"
echo "-----------------------------------"
if [[ -n "$ip" ]]; then
  echo "Use from phones / other PCs on the same Wi‑Fi:"
  echo "  http://${ip}:3040"
  echo ""
  echo "For sign-in and redirects from those devices, set in .env then restart:"
  echo "  NEXT_PUBLIC_APP_URL=http://${ip}:3040"
else
  echo "Could not detect an IPv4 on the default route. Check System Settings → Network, then set:"
  echo "  NEXT_PUBLIC_APP_URL=http://<your-ip>:3040"
fi
echo ""
echo "macOS: if others cannot connect, allow incoming for Node (or Terminal) in"
echo "  System Settings → Network → Firewall → Options."
echo ""
echo "Listening on 0.0.0.0:3040 ..."
echo ""

exec npx next dev -p 3040 -H 0.0.0.0
