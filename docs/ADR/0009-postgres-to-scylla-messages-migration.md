# ADR-0009: Postgres → ScyllaDB messages-store migration

- **Status:** Proposed
- **Date:** 2026-05-26
- **Deciders:** AAELink architecture team
- **Related:** `docs/BLUEPRINT.md` § 4.5; audit-2026-05-26 DRIFT-004; CHG-010; `docs/ROADMAP.yaml` post-ga.scylla-messages-migration

## Context

`docs/BLUEPRINT.md` § 4.5 names ScyllaDB as the GA messages store: "Scylla for messages — write-optimized, 1M+ ops/sec/node". `aaelink.messages` lives in Postgres today and was identified by the 2026-05-26 audit as the largest single-table source of fan-out latency at the BLUEPRINT § 5.4 scale targets (250k messages/sec/region, 5M concurrent WebSockets/region).

ENTERPRISE-BLUEPRINT.md and `docs/ROADMAP.yaml` (pre-CHG-010) had no migration item. Audit DRIFT-004 records the gap.

## Decision

Migrate the `messages` write path off Postgres onto ScyllaDB after the messaging-svc microservice is extracted (`messaging-svc-extraction`, milestone M5). Postgres remains the system of record for `users`, `workspaces`, `channels`, `channel_members`, and audit/compliance tables that benefit from relational integrity.

## Alternatives considered

1. **Stay on Postgres + Citus.** BLUEPRINT § 4.5 names Citus for sharded write workloads. Acceptable as a stopgap but does not hit the 1M ops/sec/node target without aggressive sharding. Reject as the GA target; keep as a v0.1.0-beta bridge.
2. **Move messages to a dedicated MySQL Vitess cluster.** Comparable scale story; weaker integration with the AAELink Postgres ecosystem (auth, audit, retention all stay on Postgres). Reject.
3. **Keep Postgres and over-provision.** 4× replication + read replicas can hit ~100k ops/sec total; insufficient at BLUEPRINT § 5.4 targets. Reject.

## Consequences

### Positive
- Hits the BLUEPRINT § 5.4 250k messages/sec/region target.
- Latency on the hot write path drops because ScyllaDB tail latency is more predictable than Postgres at the same load.
- Forces a clean messaging-svc boundary that helps subsequent extractions.

### Negative
- Two SoR engines = two operational profiles (backup, restore, monitoring, schema migration tools).
- Joins between `messages` and `users`/`channels` move into the application layer.
- Onboarding cost: new on-call playbook, new failure modes.

### Neutral
- The migration is a one-way door once written; require a dual-write window (writes go to both stores, reads from Postgres) before a switchover.

## Implementation notes

- Sequence: dual-write phase (Postgres + Scylla) → read-shadow phase (compare results) → cutover → Postgres deprecation.
- Schema mapping documented under `docs/architecture/scylla-messages-schema.md` (to be authored alongside the M5 ticket).
- The ScyllaDB cluster is co-located with the messaging-svc; no cross-region replication on day one (uses BLUEPRINT § 5.5 per-workspace residency map for region pinning).

## References

- `docs/BLUEPRINT.md` § 4.5 (data layer)
- `docs/audit-2026-05-26.md` § Goal Drift Flags — DRIFT-004
- `.kiro/stories/chg-010-roadmap-blueprint-alignment.md`
