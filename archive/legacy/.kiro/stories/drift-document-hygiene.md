---
source_finding: DRIFT-013,DRIFT-014,DRIFT-017,DRIFT-026
pillar: "🎯 Goal Drift Flags"
severity: P2
slug: drift-document-hygiene
created_at: 2026-05-26
audit_run: docs/audit-2026-05-26.md
---

# Story: Reference_Document hygiene block

## Drifts covered
- DRIFT-013 — ENTERPRISE-BLUEPRINT § 8.6 omits cross-region p95 ≤ 400 ms target.
  Plan: amend § 8.6 to add the cross-region target alongside in-region.
- DRIFT-014 — ENTERPRISE-BLUEPRINT § 4.5 lacks data-residency region list.
  Plan: amend § 4.5 to add US, EU, UK, CA, AU, JP, IN, AE, SG verbatim from BLUEPRINT § 5.5.
- DRIFT-017 — ENTERPRISE-BLUEPRINT § 1.2 reports a test count without a coverage threshold.
  Plan: amend § 1.2 (or Appendix A) to add the BLUEPRINT § 5.2 thresholds (≥80% services / 70% UI).
- DRIFT-026 — `docs/BLUEPRINT.md` carries no machine-extractable anchors.
  Plan: closed by UPG-001 (`upg-001-blueprint-machine-extractable-anchors.md`).

## Acceptance criteria
1. ENTERPRISE-BLUEPRINT carries the cross-region target, residency list, and coverage thresholds.
2. UPG-001 lands and the audit's Phase A regex extracts ≥ 20 anchors.
