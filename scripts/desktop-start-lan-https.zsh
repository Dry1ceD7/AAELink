#!/usr/bin/env zsh
# Electron shell → https://<this-Mac-Wi-Fi-or-Ethernet-IP>:3040 with dev TLS trust (self-signed / mkcert lab).
# Use only on trusted networks. Set AAELINK_DESKTOP_TRUST_DEV_TLS=1 (this script exports it).

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ip=$(zsh "${ROOT}/scripts/lan-ipv4-print.zsh" || true)
if [[ -z "${ip// }" ]]; then
  echo "desktop-start-lan-https: could not detect IPv4. Example:" >&2
  echo "  AAELINK_DESKTOP_URL=https://192.168.1.10:3040 AAELINK_DESKTOP_TRUST_DEV_TLS=1 npm run desktop:start" >&2
  exit 1
fi
export AAELINK_DESKTOP_URL="https://${ip}:3040"
export AAELINK_DESKTOP_TRUST_DEV_TLS=1
echo "AAELINK_DESKTOP_URL=${AAELINK_DESKTOP_URL}"
echo "AAELINK_DESKTOP_TRUST_DEV_TLS=1 (dev self-signed TLS only)"
exec npm run start --prefix "${ROOT}/desktop"
