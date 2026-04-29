#!/usr/bin/env zsh
# Print this machine's primary routed IPv4 (one line), or nothing if unknown.
# Usually the Wi‑Fi or Ethernet interface used for the default route. Used by dev-lan*.zsh.

set -euo pipefail

iface=""
if [[ "$(uname -s)" == Darwin ]]; then
  iface=$(route -n get 0.0.0.0 2>/dev/null | awk '/interface:/{print $2}' | head -1)
fi
ip=""
if [[ -n "$iface" ]]; then
  ip=$(ipconfig getifaddr "$iface" 2>/dev/null || true)
fi
if [[ -z "$ip" && "$(uname -s)" == Darwin ]]; then
  for cand in en0 en1 bridge0; do
    ip=$(ipconfig getifaddr "$cand" 2>/dev/null || true)
    [[ -n "$ip" ]] && break
  done
fi

[[ -n "$ip" ]] && print -r -- "$ip"
