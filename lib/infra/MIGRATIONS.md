# AAELink — Database migrations

The schema is managed by `lib/migrationRunner.ts` and is bootstrapped from `lib/migrate.ts`. Each migration is recorded in `aaelink.schema_migrations(id, applied_at)` and runs at most once per database, even across boots and parallel processes (an advisory lock serializes startup migrations).

## Adding a new migration

1. Write the body as an `async function` in `lib/migrate.ts` (or in a future per-domain file once we split).
2. Choose the next id in the sequence — `NNN_short_snake_case`, where `NNN` is the next zero-padded number after the last entry in `MIGRATIONS`.
3. Append `{ id: 'NNN_your_change', up: yourFunction }` to the `MIGRATIONS` array.
4. Add or extend a test in `tests/migrationRunner.test.ts` if the migration's logic warrants it. Pure DDL migrations don't need a runner-level test — they're covered by the next-deploy boot.

## Forward-only contract

- **Do not edit existing migrations.** Once `applied_at` is recorded, the migration body has run on every database; changing it will not re-run anywhere and will desync the recorded baseline.
- **Renames go through additive then drop-old.** Add the new column / table, dual-write, drop the old one in a later migration after deploys catch up.
- **Column type changes go through a copy.** Add a new column, backfill, drop the old one, rename. Spans 2-3 deploys.

There is intentionally no `down()` API. Forward-only migrations are easier to reason about and match what most large projects converge on. To revert a change, ship a new migration that undoes it.

## Synthetic baseline

Existing populated databases (the ones that pre-date the runner) are recognized by probing `aaelink.users`. If that table exists and `schema_migrations` has zero rows, the runner records `001_initial_schema` as already-applied without running it. This makes the v0.0.57 rollout safe across all existing dev/staging/prod databases — no schema is touched, only bookkeeping is added.

If you ever need to tear down and re-run from scratch on a developer machine:

```sql
DROP SCHEMA aaelink CASCADE;
```

Then restart the app — `001_initial_schema` will run from the start because the legacy probe will return false.

## Order matters

Migrations run in `MIGRATIONS` array order. The id string is a label, not a sort key. Don't rely on lexicographic ordering of the ids.

## Testing locally

`npm test -- migrationRunner` runs the eight unit tests against the in-memory stub pool. A real-Postgres integration test will land in v0.0.58 alongside the first carved-out domain.
