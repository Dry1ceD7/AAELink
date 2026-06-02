# Audit 2026-05-26 — Remediation Workflow

This document captures the ordered execution of every audit finding from
`docs/audit-2026-05-26.md` (the chat-rendered audit dated 2026-05-26).

**Ordering rule.** Findings execute in this order:
`🔴 Critical → 🟠 Required → 🟡 Recommended → 🗑️ Deletions → ✅ Improvements
→ ⚖️ Slack Parity Gaps → 🎯 Goal Drift Flags`. Within a pillar, fixes that
break others execute first.

**Cadence rule.** After each pillar group lands, the four gates run:
`tsc --noEmit`, `eslint .`, `vitest run`, `next build`. The "shipped" label is
only valid when all four pass with exit code 0.

**Tracking rule.** Every change is recorded in
`docs/audit-2026-05-26-changelog.md` with the Finding ID it closes, the file(s)
touched, and the verification gate it survived.

---

## Phase 1 — In-session direct edits (Critical + Required + Deletions + Improvements)

These are mechanically safe: small surface, deterministic outcome,
verifiable in one read.

| Step | Finding | Action |
|------|---------|--------|
| 1.1 | CRIT-001 | `lib/csrf.ts` — fail-fast on missing `CSRF_SECRET`; add regression test |
| 1.2 | CRIT-001 | `.env.example` — document `CSRF_SECRET` with a generation command |
| 1.3 | CRIT-002 | `app/api/admin/prometheus/route.ts` — wrap with `tracedRoute()` + admin-role guard + IP allowlist |
| 1.4 | CRIT-003 | `lib/worker.ts` — replace `new Pool(...)` with `getPool()` from `lib/db.ts` |
| 1.5 | CRIT-004 | `docs/ENTERPRISE-BLUEPRINT.md` — replace supersession claim with companion-document framing |
| 1.6 | CHG-002 | `middleware.ts` — Redis-backed rate-limit fallback (with in-process backup) |
| 1.7 | CHG-004 | `middleware.ts` — emit `Content-Security-Policy` header from `lib/csp.ts` |
| 1.8 | CHG-007 | `__tests__/helpers.ts` — route through `getPool()` test scope |
| 1.9 | CHG-008 | `package.json` — pin `postcss ^8.5.10` via `overrides` to clear advisory |
| 1.10 | CHG-009 | `docs/parity-reference-matrix.md` — replace stale matrix with the rebuilt 14-category one |
| 1.11 | DEL-001 | `git rm sqlite.db` (0-byte stale) |
| 1.12 | DEL-002 | `tsconfig.tsbuildinfo` — confirm `.gitignore` covers it (already added); `git rm --cached` |
| 1.13 | DEL-003 | `app/api/test/**` — assert no production-only handlers; otherwise guard |
| 1.14 | DEL-004 | `.kiro/settings/mcp.json` — remove disabled empty-token slots OR document activation |
| 1.15 | DEL-005 | `_skills-import/` already gitignored; leave on disk for re-syncs |
| 1.16 | IMP-001 | Add ESLint rule banning direct `route.ts` exports (must go via `tracedRoute()`) |
| 1.17 | IMP-007 | Reaffirm stack-context guardrails by linting against forbidden imports |

After Phase 1, run the four gates. Record the result in the changelog.

---

## Phase 2 — Story stubs for multi-session work

These are too large for one in-session edit. Each generates a Story_Stub at
`.kiro/stories/<finding-slug>.md` so a follow-on agent walks the plan.

| Finding | Slug | Why deferred |
|---------|------|--------------|
| CHG-001 | `chg-001-versioned-migrations-split.md` | 2,428 lines of inline migration code → per-migration files |
| CHG-003 | `chg-003-codemod-console-to-logger.md` | 30 callsites + ESLint `no-console` rule |
| CHG-005 | `chg-005-inline-style-sweep.md` | 2,529 hits across 125 files |
| CHG-006 | `chg-006-modal-focus-trap.md` | 27 dialogs need `useFocusTrap()` migration |
| CHG-010 | `chg-010-roadmap-blueprint-alignment.md` | New ROADMAP block + 5 ADRs |
| CHG-011 | `chg-011-home-shell-split.md` | 1,808-line `app/home/page.tsx` → 5 hooks + 3 panels |
| UPG-001 | `upg-001-blueprint-machine-extractable-anchors.md` | Blueprint heading rewrite |
| UPG-002 | `upg-002-pg-stat-statements.md` | Postgres extension + admin panel |
| UPG-003 | `upg-003-typing-presence-on-ws-gateway.md` | Migrate two SSE flows to WS gateway |
| UPG-004 | `upg-004-e2e-suite-expansion.md` | 6 new specs |
| UPG-005 | `upg-005-tauri-spike.md` | 2-day desktop client spike |
| UPG-006 | `upg-006-openapi-from-zod.md` | Zod schemas + OpenAPI generator |
| UPG-007 | `upg-007-axe-core-in-e2e.md` | A11y gate before v0.1.0 |
| UPG-008 | `upg-008-csp-violations-endpoint.md` | `/api/csp/violations` endpoint |
| UPG-009 | `upg-009-typing-state-redis.md` | Cross-replica typing in Redis |
| UPG-010 | `upg-010-audit-shape-test.md` | Golden-file lint for `docs/audit-*.md` |
| UPG-011 | `upg-011-pool-saturation-audit.md` | Snapshot pool gauges into audit log |
| UPG-012 | `upg-012-migrate-baseline-to-sql.md` | Convert baseline migration to plain SQL |
| UPG-013 | `upg-013-perf-admin-route.md` | `/api/admin/perf` from `pg_stat_statements` |
| UPG-014 | `upg-014-restore-skill-chain.md` | Audit pipeline runs all 8 skills |

After Phase 2, every Story_Stub exists on disk under `.kiro/stories/`, pre-populated
from `STORY_TEMPLATE.md` with the `source_finding`, `pillar`, and `severity`
front matter set.

---

## Phase 3 — Slack parity & goal drift triage

Bulk parity rebuild + 26 DRIFT findings. The PARITY-001 / PARITY-002 changes
land alongside CHG-009 in Phase 1. The 26 DRIFTs are recorded as Story_Stubs
because every one names a Reference_Document edit (not application code) and
several need ADRs:

| Block | Stubs |
|-------|-------|
| Architectural drifts (DRIFT-002 through DRIFT-008, DRIFT-019) | Each gets a Story_Stub citing the BLUEPRINT § and the matching ROADMAP gap |
| AI / cloud / desktop drifts (DRIFT-009, DRIFT-010, DRIFT-011) | One Story_Stub each; DRIFT-011 maps to UPG-005 Tauri spike |
| Compliance drifts (DRIFT-012, DRIFT-018, DRIFT-019) | Single combined Story_Stub for the regulatory-set gap |
| Reference_Document drifts (DRIFT-001, DRIFT-021–DRIFT-025) | Each maps to a literal text edit in the Reference_Document |
| Authorization drifts (DRIFT-015, DRIFT-020) | Combined Story_Stub: OpenFGA + SPIFFE + mTLS + federation expansion |
| Roadmap framing drift (DRIFT-016) | Story_Stub to add `milestone:` field across `docs/ROADMAP.yaml` |
| Document hygiene (DRIFT-026, UPG-001) | Story_Stub: insert machine-extractable anchors into `docs/BLUEPRINT.md` |

After Phase 3, every Finding has either landed (Phase 1) or has a Story_Stub
with concrete acceptance criteria.

---

## Phase 4 — Verification

| Step | Action |
|------|--------|
| 4.1 | Run `npm run type-check` (gate 1) |
| 4.2 | Run `npm run lint` (gate 2) |
| 4.3 | Run `npm test` (gate 3) |
| 4.4 | Run `npm run build` (gate 4) |
| 4.5 | Confirm changelog reflects every Finding with status `landed` or `stubbed` |
| 4.6 | Confirm no Finding has status `skipped` (audit hard rule) |

A Finding qualifies as `landed` only when its Phase 1 step passed all four gates.
A Finding qualifies as `stubbed` only when its Story_Stub file exists under
`.kiro/stories/` with the correct front matter and the body extends
`STORY_TEMPLATE.md`.

---

## Tracking format

Every entry in `docs/audit-2026-05-26-changelog.md` follows this row shape:

```
| <FindingID> | <step #> | <status> | <files touched> | <gate result> | <notes> |
```

Statuses:
- `landed` — code edit shipped, gates green
- `stubbed` — Story_Stub on disk, body matches template, awaiting follow-up
- `blocked` — environment limitation prevented the change (must include reason)
- `skipped` — never used; presence of this status fails the audit run

---

## Origin

Generated from the 2026-05-26 audit run. Source-of-truth chat output lives in
the audit deliverable; this file is the operational plan for executing it.
