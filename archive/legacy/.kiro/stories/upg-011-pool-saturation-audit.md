---
source_finding: UPG-011
pillar: "🟡 Upgrades Recommended"
severity: P2
slug: upg-011-pool-saturation-audit
created_at: 2026-05-26
audit_run: docs/audit-2026-05-26.md
---

# Story: Snapshot db pool gauges into audit log when near saturation

- **Roadmap milestone:** v0.0.60-alpha
- **Size:** S

## Scope
- Add a worker tick that runs `SELECT count(*) FROM pg_stat_activity WHERE state='active'`.
- When `count > pool.max * 0.8`, write an `audit_log` row with `action='pool.saturation'` and metadata.
- Surface in admin observability panel.

## Acceptance criteria
1. Synthetic load test triggers the audit row.
2. Four gates pass.
