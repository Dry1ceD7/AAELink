---
source_finding: CHG-005
pillar: "🟠 Changes Required"
severity: P1
slug: chg-005-inline-style-sweep
created_at: 2026-05-26
audit_run: docs/audit-2026-05-26.md
---

# Story: Lift inline-style hits to design-system primitives

- **Status:** Draft
- **Created:** 2026-05-26
- **Owner:** unassigned
- **Roadmap milestone:** v0.0.60-alpha (sweep starts) → v0.0.65-alpha (gate)
- **Size:** XL (broken into 5 PRs)

## Context
2,529 `style={{...}}` hits across 125 files. The Wave-1 design system primitives shipped in v0.0.44 (`Surface`, `Stack`, `Modal`, `Tooltip`, `Skeleton`, `EmptyState`, `ErrorState`) but adoption regressed since the 2026-05-19 audit (was 2,254 across 88 files).

## Scope
PR 1: `app/onboarding/loading.tsx` (11 inline blocks → `<Skeleton>`)
PR 2: top-3 admin offenders (`LegalHoldPanel` 68, `EKMPanel` 67, `TicketingSettingsPanel` 66)
PR 3: `app/login/page.tsx` SSO button → utility class
PR 4: remaining admin panels
PR 5: ESLint rule banning `style={{...}}` outside an allowlist

## Acceptance criteria
1. Each PR drops the project-wide inline-style count by ≥ 200.
2. Final PR: count ≤ 50 (curated allowlist) + ESLint rule promoted to `error`.
3. Four gates pass on every PR.
4. Visual regressions caught by Playwright snapshot specs (added in PR 1).

## References
- `docs/audit-2026-05-26.md` § Required Changes — CHG-005
- `docs/audit-2026-05-19.md` Wave-1 design system manifest
