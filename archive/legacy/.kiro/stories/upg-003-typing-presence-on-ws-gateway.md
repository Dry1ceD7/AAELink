---
source_finding: UPG-003
pillar: "🟡 Upgrades Recommended"
severity: P2
slug: upg-003-typing-presence-on-ws-gateway
created_at: 2026-05-26
audit_run: docs/audit-2026-05-26.md
---

# Story: Migrate typing + presence from SSE/poll to WS gateway

- **Roadmap milestone:** v0.0.43-alpha (already on roadmap as `typing-presence-ws`); pending
- **Size:** L

## Context
`lib/wsGateway/router.ts` covers 6 of 8 `PubSubEvent` variants. Typing (`app/api/typing/route.ts`, 5s TTL polling) and presence (`app/api/collab/presence/route.ts`, 10s heartbeat) still take the legacy SSE path.

## Scope
- Add `typing` + `presence` event types to `lib/wsGateway/protocol.ts`.
- Subscribe via `connectWsCollab` in `lib/realtime.ts`.
- Mid-session WS↔SSE downgrade (already noted in 2026-05-19 audit as v0.0.51).
- Deprecate `app/api/typing/route.ts` once the WS path is shipped.

## Acceptance criteria
1. `lib/wsGateway/router.ts` covers 8/8 `PubSubEvent` variants.
2. Typing latency < 100ms p95 (was ~2s with HTTP polling).
3. Four gates pass.

## References
- `docs/audit-2026-05-26.md` § Upgrades — UPG-003
- `docs/audit-2026-05-19.md` v0.0.51 plan
