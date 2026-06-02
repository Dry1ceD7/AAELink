# ADR-0011: Next /api/ws bridge → Elixir/OTP realtime gateway

- **Status:** Proposed
- **Date:** 2026-05-26
- **Deciders:** AAELink architecture team
- **Related:** `docs/BLUEPRINT.md` § 4.4; audit-2026-05-26 DRIFT-003; CHG-010; `docs/ROADMAP.yaml` post-ga.realtime-gw-extraction

## Context

BLUEPRINT § 4.4 names an Elixir/OTP realtime gateway with **≥ 2M concurrent WebSocket connections per region**, NATS as a pub-sub option, and Kafka per-workspace partitioning for fanout. AAELink today exposes `app/api/ws/route.ts` (Next.js Edge runtime) plus a sidecar `scripts/wsGateway.ts` that uses `lib/wsGateway/router.ts`. The current shape works to ~50k WS/pod; BLUEPRINT § 5.4 names 50k WS/gateway pod and 5M WS/region as targets, which means the Node-based gateway does not horizontally compose at the GA target.

Audit DRIFT-003 records the gap.

## Decision

Extract a standalone Elixir/OTP service for WebSocket termination at milestone M5. The Next.js app no longer exposes `/api/ws` after the cutover; the gateway terminates WS, subscribes to the Kafka backbone (ADR-0010), and forwards events to clients with the same protocol shape that `lib/wsGateway/protocol.ts` documents today.

## Alternatives considered

1. **Stay on Node + horizontal scale-out of `wsGateway.ts`.** Each Node process tops out at ~30–50k connections (event-loop saturation under fanout). Hitting 5M WS/region requires 100+ pods; viable but expensive in CPU and memory. Reject.
2. **Adopt Phoenix Channels (Elixir).** A stronger version of (1): Phoenix Channels is a higher-level abstraction over Elixir/OTP. Acceptable as an implementation detail under this ADR, not as a different decision.
3. **Build on Rust + Tokio.** Comparable scale story; weaker library ecosystem for distributed-cluster discovery and supervision. Reject.

## Consequences

### Positive
- Hits the BLUEPRINT § 4.4 / § 5.4 targets without horizontal-scale gymnastics.
- Cleaner cluster-wide messaging via OTP gen_servers / `:pg` instead of Redis pattern subscriptions.
- The Next.js app is freed from the long-lived-connection model; serverless deployment becomes feasible.

### Negative
- Two languages in production (TypeScript + Elixir).
- New on-call surface; the existing Postgres MCP-based observability pipeline does not cover Elixir out of the box.

### Neutral
- The protocol stays identical (`lib/wsGateway/protocol.ts`); clients do not rebuild their wire format.

## References

- `docs/BLUEPRINT.md` § 4.4
- `docs/audit-2026-05-26.md` § Goal Drift Flags — DRIFT-003
- `docs/ADR/0010-kafka-event-backbone.md`
