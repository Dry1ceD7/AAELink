#!/usr/bin/env zsh
# Point the Electron shell at this Mac's Wi‑Fi/same-network URL (same as npm run dev:host / dev:wifi:auto).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ip=$(zsh "${ROOT}/scripts/lan-ipv4-print.zsh" || true)
if [[ -z "${ip// }" ]]; then
  echo "desktop-start-lan: could not detect IPv4. Set AAELINK_DESKTOP_URL manually, e.g." >&2
  echo "  AAELINK_DESKTOP_URL=http://192.168.1.10:3040 npm run desktop:start" >&2
  exit 1
fi
export AAELINK_DESKTOP_URL="http://${ip}:3040"
echo "AAELINK_DESKTOP_URL=${AAELINK_DESKTOP_URL}"
exec npm run start --prefix "${ROOT}/desktop"
