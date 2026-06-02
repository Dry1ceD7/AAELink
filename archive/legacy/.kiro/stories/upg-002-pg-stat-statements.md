---
source_finding: UPG-002
pillar: "🟡 Upgrades Recommended"
severity: P2
slug: upg-002-pg-stat-statements
created_at: 2026-05-26
audit_run: docs/audit-2026-05-26.md
---

# Story: Install pg_stat_statements + slow-query panel

- **Roadmap milestone:** v0.0.59-alpha
- **Size:** S

## Context
Without `pg_stat_statements` the team cannot define p95 SLO alerts on actual slow queries. One-line `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;` migration + admin panel.

## Scope
- New SQL migration `migrations/0002_pg_stat_statements.sql`.
- Surface top-N slow queries in `app/components/admin/ObservabilityPanel.tsx`.
- New `app/api/admin/perf/route.ts` (covered by UPG-013 separately).

## Acceptance criteria
1. `\\dx` lists `pg_stat_statements`.
2. ObservabilityPanel shows top-10 by total_time and mean_time.
3. Four gates pass.

## References
- `docs/audit-2026-05-26.md` § Upgrades — UPG-002
