---
source_finding: DRIFT-001,DRIFT-021,DRIFT-022,DRIFT-023,DRIFT-024,DRIFT-025
pillar: "🎯 Goal Drift Flags"
severity: P2
slug: drift-reference-document-block
created_at: 2026-05-26
audit_run: docs/audit-2026-05-26.md
---

# Story: Reference_Document text edits

## Drifts covered + closed status
- DRIFT-001 — ENTERPRISE-BLUEPRINT supersession claim → **closed by audit CRIT-004** (text edit landed in this run).
- DRIFT-021 — `docs/NORTH-STAR-A.md` title invites confusion with the canonical north star.
  Plan: rename to `docs/quickstart-collaboration-hub.md` or amend title prefix to "Quickstart —".
- DRIFT-022 — NORTH-STAR-A makes SSE primary; BLUEPRINT puts WebSocket primary.
  Plan: amend `docs/NORTH-STAR-A.md` § Realtime to mark WS as primary.
- DRIFT-023 — NORTH-STAR-A IA collapses to 5 entities; BLUEPRINT names a richer hierarchy.
  Plan: amend the lead bullet to reference the BLUEPRINT § 3.2 IA tiers.
- DRIFT-024 — NORTH-STAR-A storage stack drops Citus / Scylla / OpenSearch / Neo4j / ClickHouse / Kafka / Temporal.
  Plan: amend the lead bullet to label Postgres + S3 as the v0.0.x starting point with a forward link to BLUEPRINT § 4.5.
- DRIFT-025 — NORTH-STAR-A documents `AAELINK_OPEN_REGISTRATION` not in BLUEPRINT auth stack.
  Plan: ADR-0015 records the decision (formalize in BLUEPRINT § 5.5 OR mark as v0.0.x deployment-time toggle).

## Acceptance criteria
1. `docs/NORTH-STAR-A.md` carries the four corrections above.
2. ADR-0015 exists with a decision recorded.
