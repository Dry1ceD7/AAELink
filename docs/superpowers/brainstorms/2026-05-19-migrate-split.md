# Brainstorm — `lib/migrate.ts` versioned-migrations split

**Date:** 2026-05-19
**Status:** Draft. Awaiting sign-off before any code is written.
**Audit reference:** doc B1 (P1)
**Methodology:** Superpowers `brainstorming` → `writing-plans` → `executing-plans` → TDD per task → review → finishing-a-development-branch.

## The shape of the problem

`lib/migrate.ts` is 2,402 lines. It defines the entire database schema as a single async `run()` function called by `ensureSchema()`. The current implementation is "fat idempotent" — every migration is a `CREATE TABLE IF NOT EXISTS` or `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so re-running on an already-migrated database is safe but slow (50+ statements every cold boot).

What's good about it today:

- **Idempotent.** Re-running on any schema state converges. No "down" migration needed because everything is `IF NOT EXISTS`.
- **One file, one boot path.** `ensureSchema()` is called once per process, gated by a module-level `migrateOnce` promise. No race conditions.
- **The pg_trgm-style "best effort" features** (e.g., `idx_messages_body_search`) are guarded with try/catch so a missing extension doesn't crash startup.

What's not good:

- **No version pinning.** When a deployment goes wrong mid-migration, there's no way to tell what state the database is in. The fix is "re-run and hope" because every statement is `IF NOT EXISTS`.
- **No `down` paths.** A deployment that ships the wrong column type can't be reverted without manual SQL.
- **Slow cold start.** ~50+ statements every boot, even when the schema is fully up. On a warm Postgres this is ~200ms; on a cold connection it's measurable in user-perceived latency.
- **Hard to review.** A 2,402-line schema file can't be diffed sensibly when a single new table is added; the noise hides the signal.
- **Hard to test.** The whole migration runs in one transaction-less batch. No way to test that a single migration step is correct without spinning up a full database.
- **The 16 redundant `CREATE INDEX IF NOT EXISTS` we already identified** (audit B2) live in here. The redundancy is invisible because the file is too long to read in one sitting.

## The two camps

There are two well-known patterns for this problem. Each has tradeoffs.

### Camp A — "Versioned migrations table"

Add a `aaelink.schema_migrations(version, applied_at)` table. Each migration is a separate function with a stable string ID like `001_initial_schema`, `002_add_status_emoji`, `003_add_dm_channels`. On boot, `ensureSchema()` reads `schema_migrations`, runs only the migrations not yet applied, and inserts the version row inside the same transaction.

Pros:
- Industry standard. Anyone joining the project recognizes the pattern from Rails, Django, Knex, Prisma, etc.
- Cold boot is O(0) once warm — just one `SELECT FROM schema_migrations`.
- Bisectable. If a deploy breaks, you can read `schema_migrations` to know exactly what state you're in.
- Each migration becomes a small, readable, reviewable unit (~30–80 LOC).
- Can add `down` paths file-by-file as the codebase matures, without breaking existing migrations.

Cons:
- One-time cost: write the bootstrap migration that captures the current schema as `001_initial_schema`. If this is wrong, every fresh database starts in a broken state.
- Need to decide what to do with existing production databases that don't yet have a `schema_migrations` row. Most projects ship a "synthetic baseline" — on first boot, if the table is missing but tables already exist, mark all current migrations as already-applied.
- Multi-process race on first boot. Need an advisory lock.

### Camp B — "Keep idempotent, modularize for readability"

Don't add a versioning table. Just split `migrate.ts` into per-domain files (`migrate-core.ts`, `migrate-messaging.ts`, `migrate-ticketing.ts`, etc.) and have `ensureSchema()` call them in order. Drop the obvious redundancies.

Pros:
- Zero migration risk. The shape of the production schema doesn't change.
- Cheap to ship — ~1 day, not ~3.
- Solves the "hard to review" and "16 redundant indexes" problems immediately.

Cons:
- Doesn't solve the "no version pinning" problem. Mid-migration failures are still ambiguous.
- Doesn't solve the "slow cold start" problem.
- Doesn't enable per-step testing.
- Likely has to be redone in 3–6 months when the project hits the version-pinning pain wall.

## Questions to answer before writing code

These are the design questions a sub-agent or reviewer would ask. Answer them up front so the plan doesn't get rewritten halfway through.

1. **What is the timeline?** If we want this shipped in <2 days, Camp B is the only option. If we have ~3 days, Camp A is feasible. Are there deployments waiting on either path?

2. **Are there production databases right now that we can't restart cleanly?** If yes, the answer must include a "synthetic baseline" strategy for marking existing tables as already-migrated. If no (e.g., dev + staging only), we can run a one-shot baseline script.

3. **Is there a CI test that runs `ensureSchema()` against a fresh Postgres?** If not, we lose our safety net for the bootstrap migration. Need to add a test before splitting.

4. **What's the contract for migrations going forward?** Two options:
   - "Forward-only" — migrations are append-only. Renames go through add-new-column / dual-write / drop-old-column over multiple deploys. (This is what most large projects converge on.)
   - "Forward + Down" — every migration ships with a `down()`. (Rarely used in practice; expensive to write and maintain.)

5. **What about the 16 redundant indexes (audit B2)?** Drop them in the bootstrap migration, or keep them as `DROP INDEX IF EXISTS` in a separate cleanup migration `017_drop_redundant_indexes`?

6. **What about ALTER TABLE statements?** The current file has many `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Do these become their own numbered migrations, or do they fold into the table they belong to?

7. **What's the test strategy?** Test each migration in isolation with a fresh schema? Or test `ensureSchema()` end-to-end with the full migration list?

## My recommendation

Based on the audit doc severity (P1, medium-term), the size of the team (single-driver right now), and the existing safety net (zero CI Postgres tests):

**Camp A — but in three releases, not one.**

- **v0.0.5x** — `schema_migrations` table + advisory lock + `tests/migrate.test.ts` running against an in-memory Postgres or a pg_lite stub. No actual schema changes. The current `run()` becomes the body of `001_initial_schema` so the bootstrap is "if no rows in schema_migrations, mark 001 as applied and call the existing function once". This is reversible — if it's wrong, drop the new table.
- **v0.0.5x+1** — Split off the first cohesive domain (probably messaging — channels, messages, deletions, reactions, read state, typing — the smallest self-contained group). Verify the bootstrap baseline still picks it up correctly. Drop the redundant indexes inside the new `002_messaging_indexes_cleanup` migration.
- **v0.0.5x+2** — Split off remaining domains in priority order (auth, support, webhooks, audit, ticketing, KB, integrations).

This keeps each release reviewable in <30 minutes and keeps the production rollback story simple at every step.

## Out of scope (for the brainstorm)

- Replacing `pg` with a different driver.
- Replacing the migration mechanism with Prisma / Drizzle / Kysely. The audit didn't ask for this and it would be a much bigger change.
- A web UI for migration status (interesting, not P1).
- Backfilling existing data (audit A4, separate plan needed).

## Sign-off needed

Before writing the v0.0.5x release that creates `schema_migrations` and the test harness, I need to confirm:

- Camp A vs Camp B (recommendation: A, three releases)
- Forward-only vs forward+down (recommendation: forward-only)
- Test strategy: integration tests against a real Postgres in CI (recommendation: yes, add it now since we don't have it)
- Whether the bootstrap migration drops the 16 redundant indexes immediately or leaves them for a cleanup migration (recommendation: cleanup migration, in v0.0.5x+1, so the bootstrap is purely "freeze current schema as applied")

If these answers are agreed, I'll write the executable plan in `docs/superpowers/plans/2026-05-19-migrate-split.md` and then ship the v0.0.5x release. If any of them need to change, this doc gets updated and re-discussed first.
