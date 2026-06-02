---
source_finding: UPG-001
pillar: "🟡 Upgrades Recommended"
severity: P2
slug: upg-001-blueprint-machine-extractable-anchors
created_at: 2026-05-26
audit_run: docs/audit-2026-05-26.md
---

# Story: Add machine-extractable goal anchors to docs/BLUEPRINT.md

- **Roadmap milestone:** v0.0.59-alpha (doc-only)
- **Size:** S

## Context
Phase A of the audit run extracted an empty `BlueprintGoal[]` because no L2/L3 heading prefix-matches `/^(Goal|Requirement|Objective|Capability)/i` and no bullet matches `/^MUST|^SHALL|^Provide|^Support/i`. Substance is correct; the vocabulary just doesn't expose anchors. Future audits gain coverage for free.

## Scope
- Insert `Goal:` / `Requirement:` / `Objective:` prefixes on the relevant L2/L3 headings.
- Convert the relevant bullets to `MUST` / `SHALL` shape.
- No substance change.

## Acceptance criteria
1. The Phase A regex extracts ≥ 20 anchors from `docs/BLUEPRINT.md`.
2. Heading text remains semantically equivalent.
3. `/aae-blueprint-align` reports no regressions.

## References
- `docs/audit-2026-05-26.md` § Upgrades — UPG-001
- DRIFT-026 (closed by this story)
