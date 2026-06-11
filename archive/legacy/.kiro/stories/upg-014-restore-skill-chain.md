---
source_finding: UPG-014
pillar: "🟡 Upgrades Recommended"
severity: P2
slug: upg-014-restore-skill-chain
created_at: 2026-05-26
audit_run: docs/audit-2026-05-26.md
---

# Story: Restore 8-skill audit chain so future runs cover all pillars

- **Roadmap milestone:** v0.0.59-alpha
- **Size:** S

## Context
The 2026-05-26 audit ran skill 1 of 8 (`aaelink-blueprint`) only. Skills 2–8 (`aaelink-feature-parity`, `aaelink-rbac-audit`, `/aae-security-audit`, `/aae-perf-audit`, `/aae-test-gap`, `aaelink-compliance`, `aaelink-realtime`) emitted `_scratch/findings/` files in earlier runs but did not in this one.

## Scope
- Audit run script ensures all 8 skills emit `_scratch/findings/<skill>.md`.
- Phase B run-log shows started/ended for every step.
- If a skill cannot run, emit a synthetic 🔴 CRIT Finding per the design spec.

## Acceptance criteria
1. Next audit run produces 8 `_scratch/findings/*.md` files.
2. Run-log table shows 8 rows.
