---
source_finding: CHG-010
pillar: "🟠 Changes Required"
severity: P1
slug: chg-010-roadmap-blueprint-alignment
created_at: 2026-05-26
audit_run: docs/audit-2026-05-26.md
---

# Story: Append BLUEPRINT § 4/§ 5 targets to docs/ROADMAP.yaml + 5 ADRs

- **Status:** Draft
- **Roadmap milestone:** v0.0.60-alpha (planning); v1.0.0 (delivery)
- **Size:** L

## Context
40 ROADMAP items today; zero target the BLUEPRINT § 4/§ 5 stack: ScyllaDB, Kafka/Redpanda, Elixir/OTP gateway, OpenSearch+vector+LTR, Neo4j, ClickHouse, Temporal, OpenFGA+SPIFFE+mTLS, Tauri, ISO 27017/27018, FINRA/SEC 17a-4, p95 ≤ 400ms cross-region, 9-region data residency. Closes 11 of the 26 DRIFTs (DRIFT-002–008, DRIFT-011, DRIFT-013–015, DRIFT-019).

## Scope
- Append `post_ga:` block to `docs/ROADMAP.yaml` with one item per BLUEPRINT target.
- Add `milestone:` field across all items mapping to BLUEPRINT § 6.1 M0–M8.
- Open ADRs:
  - ADR-0009 — Postgres → ScyllaDB messages migration plan
  - ADR-0010 — Redis pub/sub → Kafka/Redpanda backbone
  - ADR-0011 — Next /api/ws bridge → Elixir/OTP gateway
  - ADR-0012 — Roles → OpenFGA + ABAC overlays
  - ADR-0013 — Electron → Tauri desktop migration

## Acceptance criteria
1. `docs/ROADMAP.yaml` references every BLUEPRINT § 4/§ 5 target by name.
2. Every roadmap item carries a `milestone: M0..M8` field.
3. ADRs 0009–0013 exist under `docs/ADR/` with status `Proposed`.
4. `/aae-blueprint-align` reports no new blockers.

## References
- `docs/BLUEPRINT.md` § 4 + § 5 + § 6.1
- `docs/audit-2026-05-26.md` § Required Changes — CHG-010
