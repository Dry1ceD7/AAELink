# ADR-0010: Redis pub/sub → Kafka / Redpanda event backbone

- **Status:** Proposed
- **Date:** 2026-05-26
- **Deciders:** AAELink architecture team
- **Related:** `docs/BLUEPRINT.md` § 4.1, § 4.4, § 4.5; audit-2026-05-26 DRIFT-005; CHG-010; `docs/ROADMAP.yaml` post-ga.kafka-redpanda-backbone

## Context

`docs/BLUEPRINT.md` names Kafka or Redpanda as the GA event backbone for fanout, audit streaming, and per-workspace partitioning. AAELink today uses Redis pub/sub via `lib/redisPubSub.ts` and the v0.1.0-beta `redis-fanout-scale` item that replaces `pg_notify` with Redis. Redis is sufficient up to single-region scale; BLUEPRINT § 5.4 250k msg/s + per-workspace partition contracts require Kafka-shape semantics (durable retention, replay, partition-level ordering).

Audit DRIFT-005 records the gap.

## Decision

Adopt Kafka or Redpanda as the GA event backbone after `realtime-gw-extraction` lands. Per-workspace partitioning is the partition key. The Redis path stays as an in-region cache for high-frequency ephemeral events (typing indicators, presence) where Kafka's overhead outweighs its durability.

## Alternatives considered

1. **NATS JetStream.** Lower-overhead alternative; weaker audit-streaming story (consumer groups, replay semantics differ). Reject for the audit-streaming use case.
2. **AWS Kinesis.** Vendor-lock; weaker partitioning ergonomics for the per-workspace model. Reject.
3. **Stay on Redis pub/sub.** Hits a wall at scale; no replay; no durable retention beyond `redis-fanout-scale`'s in-process replay store. Reject.

## Consequences

### Positive
- Per-workspace partitioning aligns naturally with the BLUEPRINT § 5.4 fanout model.
- Durable retention + replay solves the gateway reconnection-window-replay problem at scale (today the `wsGateway/replay.ts` ring is in-memory + Redis Streams; Kafka replaces both for the workspace-bound topics).
- Decouples the messaging path from the realtime path so the gateway can scale independently.

### Negative
- Operational footprint grows (broker cluster, schema registry).
- Latency floor is higher than Redis (~5ms vs ~1ms); fine for fanout but pushes typing/presence to stay on Redis.

### Neutral
- Redpanda is API-compatible with Kafka; choice between the two is a deployment decision, not a code decision.

## References

- `docs/BLUEPRINT.md` § 4.1, § 4.4, § 4.5
- `docs/audit-2026-05-26.md` § Goal Drift Flags — DRIFT-005
