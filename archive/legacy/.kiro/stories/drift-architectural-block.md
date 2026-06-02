---
source_finding: DRIFT-002,DRIFT-003,DRIFT-004,DRIFT-005,DRIFT-006,DRIFT-007,DRIFT-008,DRIFT-019
pillar: "🎯 Goal Drift Flags"
severity: P2
slug: drift-architectural-block
created_at: 2026-05-26
audit_run: docs/audit-2026-05-26.md
---

# Story: Architectural drift block — BLUEPRINT § 4 / § 5 vs ROADMAP

- **Status:** Draft
- **Roadmap milestone:** rolled into CHG-010
- **Size:** XL (rolls up under CHG-010)

## Drifts covered
- DRIFT-002 — 15 microservices not in ROADMAP
- DRIFT-003 — Elixir/OTP gateway not in ROADMAP
- DRIFT-004 — ScyllaDB messages not in ROADMAP
- DRIFT-005 — Kafka/Redpanda backbone not in ROADMAP
- DRIFT-006 — OpenSearch+vector+LTR not in ROADMAP (Elasticsearch alone planned)
- DRIFT-007 — Temporal workflow orchestration not in ROADMAP
- DRIFT-008 — Neo4j + ClickHouse not in ROADMAP
- DRIFT-019 — Per-region scale targets absent

## Plan
Closed by CHG-010 (`chg-010-roadmap-blueprint-alignment.md`). This stub
exists to make the per-DRIFT trace explicit.
