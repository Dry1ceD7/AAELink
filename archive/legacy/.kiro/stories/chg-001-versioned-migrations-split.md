---
source_finding: CHG-001
pillar: "🟠 Changes Required"
severity: P1
slug: chg-001-versioned-migrations-split
created_at: 2026-05-26
audit_run: docs/audit-2026-05-26.md
---

# Story: Split lib/migrate.ts into versioned migration files

- **Status:** Draft
- **Created:** 2026-05-26
- **Owner:** unassigned
- **Parent plan:** `docs/audit-2026-05-26.md` § Required Changes
- **Roadmap milestone:** v0.0.59-alpha (proposed)
- **Size:** L
- **Related:** UPG-012, audit CRIT-003 (worker pool sourcing depends on a healthy migration runner)

## User story

As an AAELink maintainer, I want every schema change to live in a per-feature
migration file so I can read the schema evolution as a sequence rather than
reading 2,428 inline lines of `lib/migrate.ts`.

## Context

`lib/migrationRunner.ts` (147 lines) already implements the runner with a
bookkeeping table `aaelink.schema_migrations`. Only one migration is registered
today: `001_initial_schema`, which lives inline as
`migration001InitialSchema()` inside `lib/migrate.ts` and contains the entire
schema (~2,428 lines). Schema changes since v0.0.57 still bolt onto this
function instead of the runner.

## Scope

- **In scope:** capture `migration001InitialSchema` body verbatim in
  `migrations/0001_initial_schema.sql`. Convert the inline `await pool.query`
  calls into ordered `.sql` statements. Reduce `lib/migrate.ts` to the runner
  wrapper. Verify byte equivalence via Postgres MCP `analyze_db_health`.
- **Out of scope:** new schema changes, vacuum tuning, PG version upgrades.

## Acceptance criteria

1. `migrations/0001_initial_schema.sql` exists and contains the full body
   of the legacy `migration001InitialSchema` function, statement-for-statement.
2. `lib/migrate.ts` is ≤ 80 lines: imports `ensureMigrations`, registers the
   SQL files, and exports `ensureSchema()`.
3. `npm run type-check && npm run lint && npm test && npm run build` all pass.
4. Postgres MCP `analyze_db_health` reports no schema diff vs the v0.0.58
   baseline.
5. `tests/migrate.test.ts` continues to pass; an additional case asserts
   `aaelink.schema_migrations` lists `0001_initial_schema` as applied after
   `ensureSchema()` runs against a fresh database.

## Definition of Done

(Standard story DoD; see `.kiro/stories/STORY_TEMPLATE.md`.)

## Implementation notes

- The migration runner already supports `.sql` files via
  `migrationRunner.ts:registerSqlFile()`. No new runner code needed.
- Existing populated databases get the synthetic-baseline marker so the SQL
  body never re-runs on production.

## Test plan

| Acceptance criterion | Test file | Test name |
|----------------------|-----------|-----------|
| 1 | `tests/migrate.test.ts` | `migrations directory contains 0001 file` |
| 2 | `tests/migrate.test.ts` | `lib/migrate.ts is a thin wrapper` |
| 4 | manual via MCP | `pg.analyze_db_health` |
| 5 | `tests/migrate.test.ts` | `0001 marked applied after ensureSchema()` |

## Risks

1. The inline migration includes `IF NOT EXISTS` everywhere; the SQL file
   must preserve that idempotency so re-runs do not error.

## References

- `docs/audit-2026-05-26.md` § Required Changes — CHG-001
- `lib/migrationRunner.ts`
