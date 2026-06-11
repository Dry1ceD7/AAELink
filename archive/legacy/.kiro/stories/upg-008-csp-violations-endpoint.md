---
source_finding: UPG-008
pillar: "🟡 Upgrades Recommended"
severity: P2
slug: upg-008-csp-violations-endpoint
created_at: 2026-05-26
audit_run: docs/audit-2026-05-26.md
---

# Story: /api/csp/violations endpoint + admin panel

- **Roadmap milestone:** v0.0.59-alpha
- **Size:** S

## Scope
- New `app/api/csp/violations/route.ts` — POST collects browser violation reports.
- Persist to `aaelink.csp_violations` (new migration).
- Admin panel under `app/components/admin/CspViolationsPanel.tsx`.
- Update `lib/csp.ts` `reportUri` to point at the new endpoint.

## Acceptance criteria
1. CSP report-only mode populates the table.
2. Panel shows top-N violators with grouping by directive + URI.
3. Four gates pass.

## Depends on
- audit CHG-004 (CSP header now emitted from `middleware.ts`)
