# Plan — `lib/migrate.ts` versioned-migrations split (Camp A, three releases)

**Date:** 2026-05-19
**Source brainstorm:** `docs/superpowers/brainstorms/2026-05-19-migrate-split.md`
**Sign-off:** Camp A, forward-only, CI Postgres tests added now, redundant indexes dropped in a cleanup migration.

## Release breakdown

| Rel | Scope | Risk |
|-----|-------|------|
| **v0.0.57-alpha** | Add `schema_migrations` table + advisory lock + `runMigration` runner. Wrap existing `run()` body verbatim as `001_initial_schema`. **No schema change**, only mechanism. | Low |
| v0.0.58-alpha | Carve messaging domain out of `001` into discrete `002_*` migrations. Drop 16 redundant indexes inside `003_drop_redundant_indexes`. | Medium |
| v0.0.59-alpha | Carve remaining domains. | Low |

This release executes only **v0.0.57-alpha**.

## v0.0.57-alpha task list

### Task 1 — `lib/migrationRunner.ts` (new module, ~120 LOC, TDD)

Create the runner that maintains the `schema_migrations` table and applies migrations idempotently.

**Public surface:**

```ts
export interface Migration {
  id: string                              // e.g. '001_initial_schema'
  up: (pool: Pool) => Promise<void>
}
export async function ensureMigrations(
  pool: Pool,
  migrations: readonly Migration[]
): Promise<{ applied: string[]; alreadyApplied: string[] }>
```

**Behavior to pin with tests (TDD):**

- On first call against a fresh database: creates `aaelink.schema_migrations(id TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)`, then runs every migration in `migrations` order, inserting one row per migration, and returns `{ applied: [...], alreadyApplied: [] }`.
- On second call (same DB, same migrations): no migrations are re-run, returns `{ applied: [], alreadyApplied: [...] }`.
- A migration that throws aborts the whole run (no row inserted for it; subsequent migrations don't run). The error propagates to the caller.
- Uses `pg_advisory_lock(<some hash>)` around the run to block concurrent boots from racing the same migration. Lock is released on completion or error (try/finally).
- The migration order is determined by array order, NOT by the `id` string. The runner trusts the caller.

**Test file:** `tests/migrationRunner.test.ts` — runs against a `pg-mem` in-memory Postgres so no external DB is needed for unit tests. Production CI test goes in a separate file in v0.0.58.

### Task 2 — Wrap existing `run()` as `001_initial_schema` migration

**Refactor `lib/migrate.ts`:**

- Keep the existing `ensureSchema()` export and `migrateOnce` gate exactly as they are (callers don't change).
- Inside `ensureSchema`, build the migrations array:
  ```ts
  const migrations: Migration[] = [
    { id: '001_initial_schema', up: async (pool) => { /* the entire current run() body */ } }
  ]
  ```
- Call `await ensureMigrations(pool, migrations)`.
- The `run()` function body is moved verbatim into the `up` function. No SQL change.

This keeps the production rollback story trivial: if `v0.0.57` is wrong, revert one commit and the old `migrate.ts` is back; the `schema_migrations` table is leftover but harmless.

### Task 3 — Synthetic baseline for existing production databases

**Why:** Existing prod (and dev/staging) databases already have all the tables. Running `001_initial_schema` would be a no-op (every statement is `IF NOT EXISTS`), but inserting a row is the goal.

**How:** Inside `ensureMigrations`, before running any migration, check if the target tables already exist (probe `aaelink.users` — the oldest table). If they do AND `schema_migrations` is empty, mark `001_initial_schema` as already-applied without running it. This is the synthetic-baseline pattern.

This is encoded as one extra line at the top of `ensureMigrations`:

```ts
// Synthetic baseline: if the schema is already populated but no
// migrations are recorded, treat 001 as applied.
if (await hasLegacySchema(pool) && (await migrationCount(pool)) === 0) {
  await markApplied(pool, '001_initial_schema')
}
```

`hasLegacySchema` probes `aaelink.users`. Tested.

### Task 4 — `tests/migrationRunner.test.ts` (TDD)

Six tests written first, watched fail, then runner implemented:

1. **Bootstrap a fresh database** — empty pg-mem, run two migrations, assert both applied + rows inserted.
2. **Idempotent re-run** — same setup, run twice, assert second run reports `alreadyApplied: ['001', '002']` and inserts no new rows.
3. **Failure rolls back the rest** — second of three migrations throws; assert: `001` row exists, `002` and `003` rows do NOT exist, error propagates.
4. **Synthetic baseline** — fresh DB, manually create `aaelink.users`, run with the legacy-schema-detection path, assert `001` is marked applied without running.
5. **Order respected** — migrations array ordered `[B, A]` runs B first then A regardless of ID string.
6. **Advisory lock prevents concurrent runs** — two parallel `ensureMigrations()` calls; only one actually runs the migration. (Skipped if pg-mem doesn't support advisory locks; integration test in v0.0.58 covers it.)

### Task 5 — Documentation

Add `lib/MIGRATIONS.md` (one-pager): when to add a new migration, naming convention (`NNN_short_snake_case`), forward-only contract, no edits to existing migrations.

## Verification gates (mandatory)

- `tsc --noEmit` — exit 0
- `eslint .` — exit 0 errors
- `vitest run` — all tests green (existing 1,414 + 6 new = 1,420)
- `next build` — exit 0
- **Sanity probe** — start the app locally against an existing populated dev DB, confirm `ensureSchema()` returns immediately (synthetic baseline path), confirm app boots normally. Document the result in the release notes.

## Out of scope for v0.0.57

- Splitting `001` into smaller migrations (deferred to v0.0.58).
- Dropping the 16 redundant indexes (deferred to v0.0.58 inside `003_drop_redundant_indexes`).
- Forward CI Postgres integration test (deferred to v0.0.58 — pg-mem covers most of v0.0.57's surface).
- A `down()` API (forward-only contract per sign-off).

## Files modified / created

| File | Why |
|------|-----|
| `lib/migrationRunner.ts` | New module |
| `lib/migrate.ts` | Wrap existing `run()` as `001_initial_schema`, call `ensureMigrations` |
| `tests/migrationRunner.test.ts` | 6 TDD tests |
| `lib/MIGRATIONS.md` | Contributor doc |
| `package.json` | Bump 0.0.56 → 0.0.57-alpha |
| `docs/release-notes/v0.0.57-alpha.md` | Release notes |
| `README.md` | Version pointer + changelog row |

## Dependencies

- `pg-mem` — already pulled in transitively? Check; install if not. **Decision:** if not already present, install as a dev-only dep. If install fails or pulls a heavy tree, fall back to a stub Pool object that records SQL strings (less rigorous but still tests the runner's bookkeeping). The test file's quality bar is "verify ordering, idempotence, and the synthetic-baseline path", not "exercise every Postgres edge case".

## Estimated cost

~2 hours for the runner + tests, ~30 min to wrap the existing migration, ~15 min release notes/README/version bump. Single 3-hour session.
