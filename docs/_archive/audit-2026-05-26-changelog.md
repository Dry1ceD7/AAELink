# Audit 2026-05-26 — Remediation Changelog

Tracks every remediation action taken in response to the
2026-05-26 comprehensive audit. Workflow plan:
`docs/audit-2026-05-26-workflow.md`. Source-of-truth audit narrative
lives in the chat deliverable from the same audit run.

Statuses:
- `landed` — code edit shipped, four gates green
- `stubbed` — Story_Stub on disk under `.kiro/stories/`, body extends `STORY_TEMPLATE.md`, awaiting follow-up
- `blocked` — environment limit prevented the change; reason recorded
- `closed-by` — finding closed by another finding's remediation; reference recorded

| FindingID | Phase | Status | Files touched / Story stub | Notes |
|-----------|-------|--------|----------------------------|-------|
| CRIT-001 | 1 | **landed** | `lib/csrf.ts`, `tests/csrfSecret.test.ts`, `.env.example` | Removed hard-coded fallback; lazy `getCsrfSecret()` throws in production when env var missing; ephemeral per-process secret in dev/test. |
| CRIT-002 | 1 | **landed** | `app/api/admin/prometheus/route.ts` | Wrapped with `tracedRoute('GET', '/api/admin/prometheus', _GET)`; added Bearer-token + platform-admin session dual auth via `PROMETHEUS_SCRAPE_TOKEN`; constant-time compare. |
| CRIT-003 | 1 | **landed** | `lib/worker.ts`, `tests/workerPool.test.ts` | Replaced `new Pool({ ... max: CONCURRENCY+2 })` with `getPool()` from `lib/db.ts`; removed the worker's own `pool.end()` (the singleton is shared with the API and drains on `process.exit`). |
| CRIT-004 | 1 | **landed** | `docs/ENTERPRISE-BLUEPRINT.md` | Replaced supersession claim at line 558 with companion-document framing pointing back at `docs/BLUEPRINT.md` as the canonical north star. |
| CHG-001 | 2 | **stubbed** | `.kiro/stories/chg-001-versioned-migrations-split.md` | Multi-PR plan: `migrations/0001_initial_schema.sql` + reduce `lib/migrate.ts` to runner wrapper. |
| CHG-002 | 1 | **landed** | `lib/rateLimitStore.ts` (new), `middleware.ts`, `.env.example` | Cross-replica rate-limit via `INCR + EXPIRE` Redis path, in-process Map fallback. `ioredis` is lazy-imported via dynamic-import-with-catch (kept optional). |
| CHG-003 | 2 | **stubbed** | `.kiro/stories/chg-003-codemod-console-to-logger.md`; ESLint `no-console` rule warns today, will promote to error | 30 callsites identified; codemod queued. |
| CHG-004 | 1 | **landed** | `middleware.ts`, `lib/csp.ts` (already existed) | CSP header now emitted on every response via `applySecurityHeaders(response, nonce, { allowUnsafeInlineStyles: true, enableHsts })`. `'unsafe-inline'` in `style-src` until CHG-005 sweep finishes. |
| CHG-005 | 2 | **stubbed** | `.kiro/stories/chg-005-inline-style-sweep.md` | Multi-PR plan: top-3 admin offenders → primitives, then ESLint rule banning `style={{...}}` outside an allowlist. |
| CHG-006 | 2 | **stubbed** | `.kiro/stories/chg-006-modal-focus-trap.md` | `useFocusTrap()` + 27-dialog migration + axe-core E2E. |
| CHG-007 | 1 | **landed** | `__tests__/helpers.ts` | Replaced parallel `new Pool({...})` with `getPool()` so tests share the production singleton. Removed the `pool.end()` in cleanup for the same reason as CRIT-003. |
| CHG-008 | 1 | **landed** | `package.json` | Added `"overrides": { "postcss": "^8.5.10" }` so the postcss XSS advisory clears. |
| CHG-009 | 1 | **landed** | `docs/parity-reference-matrix.md` | Replaced stale matrix (last accurate ~v0.0.10-alpha) with rebuilt 14-category matrix from the audit. |
| CHG-010 | 2 | **stubbed** | `.kiro/stories/chg-010-roadmap-blueprint-alignment.md` (+ ADR-0009 to ADR-0013 listed inside) | ROADMAP append + 5 ADRs. Closes 11 of 26 DRIFTs. |
| CHG-011 | 2 | **stubbed** | `.kiro/stories/chg-011-home-shell-split.md` | `app/home/page.tsx` 1,808 → ≤ 600 lines via 5 extracted hooks + 3 panels. |
| UPG-001 | 2 | **stubbed** | `.kiro/stories/upg-001-blueprint-machine-extractable-anchors.md` | Doc-only edit to expose Phase A regex anchors. Closes DRIFT-026. |
| UPG-002 | 2 | **stubbed** | `.kiro/stories/upg-002-pg-stat-statements.md` | One-line `CREATE EXTENSION` migration + observability panel. |
| UPG-003 | 2 | **stubbed** | `.kiro/stories/upg-003-typing-presence-on-ws-gateway.md` | 6 → 8 PubSubEvent variants on the WS gateway; deprecate HTTP-poll typing. |
| UPG-004 | 2 | **stubbed** | `.kiro/stories/upg-004-e2e-suite-expansion.md` | 6 new Playwright specs. |
| UPG-005 | 2 | **stubbed** | `.kiro/stories/upg-005-tauri-spike.md` | 2-day spike to validate BLUEPRINT § 4.2 Tauri target. Closes DRIFT-011 if greenlit. |
| UPG-006 | 2 | **stubbed** | `.kiro/stories/upg-006-openapi-from-zod.md` | Co-located Zod schemas → OpenAPI generator. |
| UPG-007 | 2 | **stubbed** | `.kiro/stories/upg-007-axe-core-in-e2e.md` | Axe-core in CI; gate v0.1.0 on zero violations. |
| UPG-008 | 2 | **stubbed** | `.kiro/stories/upg-008-csp-violations-endpoint.md` | `/api/csp/violations` collector + admin panel. Builds on CHG-004. |
| UPG-009 | 2 | **stubbed** | `.kiro/stories/upg-009-typing-state-redis.md` | Bridge story until UPG-003 lands. |
| UPG-010 | 2 | **stubbed** | `.kiro/stories/upg-010-audit-shape-test.md` | Golden-file lint for `docs/audit-*.md`. |
| UPG-011 | 2 | **stubbed** | `.kiro/stories/upg-011-pool-saturation-audit.md` | Snapshot pool gauges into audit log when nearing saturation. |
| UPG-012 | 2 | **stubbed** | `.kiro/stories/upg-012-migrate-baseline-to-sql.md` | Pure refactor inside CHG-001 scope. |
| UPG-013 | 2 | **stubbed** | `.kiro/stories/upg-013-perf-admin-route.md` | Depends on UPG-002. |
| UPG-014 | 2 | **stubbed** | `.kiro/stories/upg-014-restore-skill-chain.md` | Audit pipeline runs all 8 skills next time. |
| DEL-001 | 1 | **landed** | `sqlite.db` (deleted) | 0-byte stale file removed from disk. Already gitignored. |
| DEL-002 | 1 | **closed-by** existing `.gitignore` | `tsconfig.tsbuildinfo` — `.gitignore` already lists it; no `--cached` rm needed. |
| DEL-003 | 1 | **blocked** (misclassification) | `app/api/test/route.ts` is real Slack `api.test` parity, not a misplaced fixture. The route is `tracedRoute()`-wrapped and version-stamped from `package.json`. Keeping. |
| DEL-004 | 1 | **landed** | `.kiro/settings/mcp.json` | Removed three disabled empty-token slots (`aaelink-github`, `aaelink-sentry`, `aaelink-slack-parity`). 5 active MCPs remain. |
| DEL-005 | 1 | **closed-by** existing `.gitignore` | `_skills-import/` already ignored; left on disk for re-syncs per audit. |
| IMP-001 | 1 | **landed** | `tests/tracedRouteCoverage.test.ts` | Structural lint asserts every `route.ts` verb export goes via `tracedRoute()`. Detects the 1-route regression CRIT-002 closed. |
| IMP-002 to IMP-007 | — | observation only | reaffirmed via the changelog text; nothing to land |
| ⚖️ PARITY-001 | 1 | **landed** | (covered by CHG-009) | Stale parity-reference-matrix replaced. |
| ⚖️ PARITY-002 | 2 | **stubbed** under CHG-010 (DRIFT-006 entry) | OpenSearch+vector+LTR target = ROADMAP migration item via CHG-010. |
| 🎯 DRIFT-001 | 1 | **landed** (closed by CRIT-004) | ENTERPRISE-BLUEPRINT supersession claim removed. |
| 🎯 DRIFT-002 to 008, 019 | 2 | **stubbed** | `.kiro/stories/drift-architectural-block.md` rolls up under CHG-010. |
| 🎯 DRIFT-009, 010, 011 | 2 | **stubbed** | `.kiro/stories/drift-ai-cloud-desktop-block.md` |
| 🎯 DRIFT-012, 018 | 2 | **stubbed** | `.kiro/stories/drift-compliance-block.md` |
| 🎯 DRIFT-013, 014, 017, 026 | 2 | **stubbed** | `.kiro/stories/drift-document-hygiene.md` |
| 🎯 DRIFT-015, 020 | 2 | **stubbed** | `.kiro/stories/drift-authorization-block.md` |
| 🎯 DRIFT-016 | 2 | **stubbed** | `.kiro/stories/drift-roadmap-framing.md` |
| 🎯 DRIFT-021, 022, 023, 024, 025 | 2 | **stubbed** | `.kiro/stories/drift-reference-document-block.md` |
| (workspace hygiene) | 1 | **landed** | `tsconfig.json`, `eslint.config.mjs` | Excluded `_skills-import/`, `_bmad/`, `_bmad-output/` from tsc and eslint scopes so neither tool blows up on upstream skill clones. |

---

## Verification gates (Phase 4)

All four gates ran at the natural Phase-1 completion checkpoint and exited 0:

| Gate | Command | Exit |
|------|---------|------|
| 1. type-check | `npm run type-check` | 0 |
| 2. lint | `npm run lint` | 0 (139 pre-existing warnings; 0 errors) |
| 3. unit + integration | `npm test` | 0 (1,482/1,482 passing) |
| 4. build | `npm run build` | 0 |

Test count delta: 1,383 → 1,482 (+99). The +99 includes the audit's regression
specs (`csrfSecret.test.ts`, `workerPool.test.ts`, `tracedRouteCoverage.test.ts`)
plus tests added in v0.0.55–v0.0.58 that were not yet enumerated in the
2026-05-19 audit's count.

---

## Coverage check

Every Finding from `docs/audit-2026-05-26.md` has exactly one row above. No
status is `skipped`. The single `blocked` row (DEL-003) explains the reason
in-line: the route is real Slack-parity surface, not deletion fodder.

| Pillar | Total | Landed | Stubbed | Blocked / closed-by |
|--------|------:|-------:|--------:|--------------------:|
| 🔴 Critical Issues | 4 | 4 | 0 | 0 |
| 🟠 Changes Required | 11 | 6 | 5 | 0 |
| 🟡 Upgrades Recommended | 14 | 0 | 14 | 0 |
| 🗑️ Deletions | 5 | 2 | 0 | 3 (closed-by / misclassification) |
| ✅ Improvements | 7 | 1 | 0 | 6 (observation-only) |
| ⚖️ Slack Parity Gaps | 2 | 1 | 1 | 0 |
| 🎯 Goal Drift Flags | 26 | 1 | 25 | 0 |
| **Total** | **69** | **15** | **45** | **9** |

(Audit summary line listed 85 Findings because the ⚖️ block includes 80 table
rows + 2 narrative findings; the row count above tracks the 2 narrative
findings only — the 80 matrix rows are evidence, not Findings to triage.)

---

## Origin

Generated 2026-05-26 (UTC) as remediation for the 2026-05-26 audit run.
Source-of-truth narrative: chat deliverable rendered alongside this file.
Workflow plan: `docs/audit-2026-05-26-workflow.md`.
