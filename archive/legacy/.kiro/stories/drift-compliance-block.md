---
source_finding: DRIFT-012,DRIFT-018
pillar: "🎯 Goal Drift Flags"
severity: P1
slug: drift-compliance-block
created_at: 2026-05-26
audit_run: docs/audit-2026-05-26.md
---

# Story: Compliance certifications + vulnerability SLA + bug bounty

## Drifts covered
- DRIFT-012 — ROADMAP only lists `1.0.0.soc2`; BLUEPRINT § 5.5 commits to SOC 2 + ISO 27001/27017/27018 + HIPAA + GDPR + FedRAMP + FINRA 17a-4 + SEC 17a-4
- DRIFT-018 — Vulnerability SLA tiers (Critical 24h / High 7d / Medium 30d / Low 90d) and public bug-bounty commitment absent

## Plan
- Append items to `docs/ROADMAP.yaml` 1.0.0 block: `iso-27001`, `iso-27017`, `iso-27018`, `hipaa`, `gdpr-ratification`, `fedramp-path`, `finra-17a4`, `sec-17a4`, `bug-bounty-public`.
- Append `vulnerability_sla:` map at the YAML top level capturing the four tiers.
- Update `docs/ENTERPRISE-BLUEPRINT.md` § 4.5 to add the SLA + missing certs.

## Acceptance criteria
1. ROADMAP item count for compliance is ≥ 8 (was 1).
2. `vulnerability_sla` map is present and machine-readable.
