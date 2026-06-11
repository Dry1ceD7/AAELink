---
source_finding: UPG-013
pillar: "🟡 Upgrades Recommended"
severity: P2
slug: upg-013-perf-admin-route
created_at: 2026-05-26
audit_run: docs/audit-2026-05-26.md
---

# Story: /api/admin/perf — top-10 slow queries from pg_stat_statements

- **Roadmap milestone:** v0.0.60-alpha
- **Size:** S

## Scope
- New `app/api/admin/perf/route.ts` — `tracedRoute()`-wrapped GET returning top-10 by total_time + mean_time.
- Admin panel `app/components/admin/PerfPanel.tsx`.

## Acceptance criteria
1. Route requires platform-admin session.
2. Surfaces query, calls, total_time, mean_time, rows.
3. Four gates pass.

## Depends on
- UPG-002 (`pg_stat_statements` installed)
