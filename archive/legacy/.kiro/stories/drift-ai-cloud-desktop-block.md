---
source_finding: DRIFT-009,DRIFT-010,DRIFT-011
pillar: "🎯 Goal Drift Flags"
severity: P2
slug: drift-ai-cloud-desktop-block
created_at: 2026-05-26
audit_run: docs/audit-2026-05-26.md
---

# Story: AI / cloud / desktop drifts

## Drifts covered
- DRIFT-009 — AI tenant isolation guarantees weakened (no "no training on your data")
- DRIFT-010 — ENTERPRISE-BLUEPRINT cloud strategy narrower than BLUEPRINT
- DRIFT-011 — Tauri migration absent

## Plan
- DRIFT-009 + DRIFT-010 → text edit in `docs/ENTERPRISE-BLUEPRINT.md` § 6.2 / § 8.5 / § 3.3 to add the BLUEPRINT § 4.7 isolation language and AWS / Azure / GCP / on-prem stance verbatim.
- DRIFT-011 → covered by UPG-005 (Tauri spike) and CHG-010 (ROADMAP entry).
