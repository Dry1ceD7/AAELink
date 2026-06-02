---
source_finding: DRIFT-015,DRIFT-020
pillar: "🎯 Goal Drift Flags"
severity: P1
slug: drift-authorization-block
created_at: 2026-05-26
audit_run: docs/audit-2026-05-26.md
---

# Story: OpenFGA + SPIFFE + mTLS + federation expansion

## Drifts covered
- DRIFT-015 — ENTERPRISE-BLUEPRINT § 4.2 lists role-hierarchy strings only; BLUEPRINT § 4.3 / § 5.5 names OAuth 2.1+PKCE, mTLS+SPIFFE, OpenFGA (ReBAC) + ABAC overlays
- DRIFT-020 — ROADMAP federation reduced to mTLS message relay; BLUEPRINT § 5.5 frames it as compliance posture (DLP egress, ethical walls, info barriers, "external" markers, multi-org from day one)

## Plan
- ADR-0012 (Roles → OpenFGA + ABAC) — covered by CHG-010
- Append to `docs/ROADMAP.yaml` 1.0.0: `openfga-rebac`, `spiffe-mtls`, `federation-dlp-egress`, `federation-ethical-walls`, `federation-info-barriers`, `federation-external-markers`.

## Acceptance criteria
1. ADR-0012 exists.
2. ROADMAP federation items expand from 2 to ≥ 7.
