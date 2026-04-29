#!/usr/bin/env zsh
# Default `npm run dev`: Next on 0.0.0.0 with HTTPS, NEXT_PUBLIC_APP_URL=https://<Wi‑Fi/same-network-IP>:3040
# (session cookies and redirects match the URL other PCs use).
#
# Optional trusted local certs (install mkcert, generate for your LAN IP):
#   export AAELINK_HTTPS_KEY=/path/to/key.pem AAELINK_HTTPS_CERT=/path/to/cert.pem
#   optional: AAELINK_HTTPS_CA=/path/to/rootCA.pem
# When unset, Next.js uses a dev self-signed certificate (browsers show a warning).

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ip=$(zsh "${ROOT}/scripts/lan-ipv4-print.zsh" || true)
if [[ -z "${ip// }" ]]; then
  ip="127.0.0.1"
  echo "dev: could not detect a Wi‑Fi / Ethernet IPv4; using ${ip} for HTTPS. Connect to the network or use npm run dev:localhost for plain http://localhost:3040." >&2
fi

export NEXT_PUBLIC_APP_URL="https://${ip}:3040"

echo "AAELink dev — HTTPS on your Mac's Wi‑Fi / same-network IP (default npm run dev)"
echo "------------------------------------------"
echo "NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}"
echo ""
echo "Other PCs — browser:  https://${ip}:3040"
echo "  Accept the certificate warning on first open (or use mkcert + AAELINK_HTTPS_* — see script header)."
echo ""
echo "Other PCs — installed desktop app: same URL (or leave env unset; dev Electron opens https://<this-Mac-IP>:3040)."
echo "This Mac from repo:  npm run desktop:start"
echo ""
echo "Trusted lab / temporary host only. For production use a reverse proxy with a publicly trusted certificate."
echo ""

args=( -p 3040 -H 0.0.0.0 )
if [[ -n "${AAELINK_HTTPS_KEY:-}" && -f "${AAELINK_HTTPS_KEY}" && -n "${AAELINK_HTTPS_CERT:-}" && -f "${AAELINK_HTTPS_CERT}" ]]; then
  args+=( --experimental-https --experimental-https-key "$AAELINK_HTTPS_KEY" --experimental-https-cert "$AAELINK_HTTPS_CERT" )
  if [[ -n "${AAELINK_HTTPS_CA:-}" && -f "${AAELINK_HTTPS_CA}" ]]; then
    args+=( --experimental-https-ca "$AAELINK_HTTPS_CA" )
  fi
else
  args+=( --experimental-https )
fi

exec npx next dev "${args[@]}"
