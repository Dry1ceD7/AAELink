---
source_finding: UPG-010
pillar: "🟡 Upgrades Recommended"
severity: P2
slug: upg-010-audit-shape-test
created_at: 2026-05-26
audit_run: docs/audit-2026-05-26.md
---

# Story: Golden-file shape test for docs/audit-*.md

- **Roadmap milestone:** v0.0.59-alpha
- **Size:** S

## Scope
- New `tests/auditShape.test.ts` parses the most recent `docs/audit-*.md`.
- Asserts: 8 required pillars in fixed order, 14-row Slack parity matrix, every Finding has `id`, `title`, `evidence`, `severityRationale`, `recommendation`, `sourceSkills`, `pillar`.
- Pulls schema from `.kiro/specs/comprehensive-project-audit/design.md` (already shipped).

## Acceptance criteria
1. Test fails when audit emits without all 8 pillars.
2. Test fails on duplicate Finding IDs.
3. Test ignores files older than 30 days (so the suite isn't held hostage to historical audits).

## References
- `.kiro/specs/comprehensive-project-audit/design.md` test strategy section
