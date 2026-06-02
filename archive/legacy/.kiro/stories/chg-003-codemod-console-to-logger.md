---
source_finding: CHG-003
pillar: "🟠 Changes Required"
severity: P1
slug: chg-003-codemod-console-to-logger
created_at: 2026-05-26
audit_run: docs/audit-2026-05-26.md
---

# Story: Codemod 30 production console.* callsites to lib/log.ts

- **Status:** Draft
- **Created:** 2026-05-26
- **Owner:** unassigned
- **Roadmap milestone:** v0.0.59-alpha
- **Size:** M

## Context
30 `console.*` callsites remain across `app/api/**` (22) and `app/components/admin/**` (8). `lib/logger.ts` exists; only 13 modules import it. The 2026-05-26 audit changelog records the residual count.

The 2026-05-26 audit also added an ESLint warn rule for `no-console` outside `lib/log.ts`/`lib/logger.ts`/`lib/tracing.ts`/`lib/auditStream.ts`. After this story lands, promote the rule to `error`.

## Scope
- In scope: rewrite each callsite via `log.error({ ctx, err })` / `log.info({ ctx }, msg)` shape; promote the ESLint rule to `error`.
- Out of scope: the four allowlisted `lib/*` modules.

## Acceptance criteria
1. `grep -rln 'console\\.' app/api app/components | wc -l` returns 0.
2. ESLint config promotes `no-console` to `error` in the `app/` + `lib/` block.
3. Four gates pass.

## Test plan
| Criterion | Test |
|-----------|------|
| 1 | `tests/consoleDrift.test.ts` (new) — recursive scan asserts zero |
| 2 | `npm run lint` exits 0 |

## References
- `docs/audit-2026-05-26.md` § Required Changes — CHG-003
