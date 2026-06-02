/**
 * AAELink — Versioned migration runner.
 *
 * Maintains an `aaelink.schema_migrations(id, applied_at)` table and
 * runs each migration exactly once across boots and processes.
 *
 * Forward-only contract — migrations are append-only. Renames and
 * column-type changes go through additive then drop-old steps over
 * multiple deploys, never edited in place.
 *
 * Synthetic baseline — when an existing populated database first sees
 * this runner, the runner detects the legacy schema (probes
 * `aaelink.users`) and records `001_initial_schema` as already-applied
 * without invoking it. Production rollback path: drop the new
 * `schema_migrations` table and revert the commit.
 *
 * Concurrency — uses `pg_advisory_lock` around the run so two parallel
 * boots can't race the same migration. The lock key is a stable
 * 32-bit integer derived from the literal `'aaelink.migrate'` so no
 * per-process state is needed.
 *
 * Tests pin the runner's behavior via a stub `RunnerPool` interface in
 * `tests/migrationRunner.test.ts`. Real-Postgres integration coverage
 * lands in v0.0.58 alongside the first carved-out domain.
 */

export interface Migration {
  /** Stable id, naming convention `NNN_short_snake_case` (e.g. `001_initial_schema`). */
  id: string
  /** Body of the migration. The runner passes the same `pool` it was given. */
  up: (pool: RunnerPool) => Promise<void>
}

/**
 * Minimal subset of `pg.Pool` the runner uses. Defining it as a
 * structural interface lets tests substitute a stub without depending
 * on a real Postgres connection.
 */
export interface RunnerPool {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>
}

export interface EnsureMigrationsResult {
  /** Migrations that ran during this call, in execution order. */
  applied: string[]
  /** Migrations that were already in `schema_migrations` and skipped. */
  alreadyApplied: string[]
}

/** 32-bit advisory lock key derived from `'aaelink.migrate'`. */
const ADVISORY_LOCK_KEY = 0x41454c4d // 'AELM'

/**
 * Run every not-yet-applied migration in `migrations`, in array order.
 *
 * Returns the IDs that ran and the IDs that were already recorded.
 * Throws if any migration's `up` throws — subsequent migrations in
 * the array are NOT attempted (we stop at the first failure).
 */
export async function ensureMigrations(
  pool: RunnerPool,
  migrations: readonly Migration[]
): Promise<EnsureMigrationsResult> {
  // Always make sure the bookkeeping table exists.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.schema_migrations (
      id         TEXT PRIMARY KEY,
      applied_at BIGINT NOT NULL
    )
  `)

  // Take the advisory lock. A real Postgres returns nothing useful
  // from this call; a stub Pool will just record the SQL and move on.
  await pool.query(`SELECT pg_advisory_lock($1)`, [ADVISORY_LOCK_KEY])

  try {
    const applied: string[] = []
    const alreadyApplied: string[] = []

    // Synthetic baseline. If the schema is already populated (legacy
    // database from before the runner existed) AND no rows are in
    // schema_migrations yet, mark `001_initial_schema` as already
    // applied without running it.
    const recordedIds = await readAppliedIds(pool)
    const hasInitial = migrations.some(m => m.id === '001_initial_schema')
    if (recordedIds.size === 0 && hasInitial && (await hasLegacySchema(pool))) {
      await markApplied(pool, '001_initial_schema')
      recordedIds.add('001_initial_schema')
    }

    for (const m of migrations) {
      if (recordedIds.has(m.id)) {
        alreadyApplied.push(m.id)
        continue
      }
      // Run the migration. If it throws, propagate — we do NOT mark it
      // applied and we do NOT attempt the next one.
      await m.up(pool)
      await markApplied(pool, m.id)
      applied.push(m.id)
    }

    return { applied, alreadyApplied }
  } finally {
    // Always release the advisory lock, even on failure.
    try {
      await pool.query(`SELECT pg_advisory_unlock($1)`, [ADVISORY_LOCK_KEY])
    } catch {
      // The unlock is best-effort. If the connection is dead, the lock
      // expires with the session anyway.
    }
  }
}

async function readAppliedIds(pool: RunnerPool): Promise<Set<string>> {
  const res = await pool.query(`SELECT id FROM aaelink.schema_migrations`)
  const ids = new Set<string>()
  for (const row of res.rows as Array<{ id?: string }>) {
    if (typeof row?.id === 'string') ids.add(row.id)
  }
  return ids
}

async function markApplied(pool: RunnerPool, id: string): Promise<void> {
  await pool.query(
    `INSERT INTO aaelink.schema_migrations (id, applied_at)
     VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [id, Date.now()]
  )
}

/**
 * Detect whether the current database already has the legacy schema
 * applied (i.e. tables exist from before this runner was added).
 *
 * The probe checks `aaelink.users` because it's the oldest table in
 * `lib/migrate.ts` — if it exists, the schema was bootstrapped by the
 * pre-runner code.
 */
async function hasLegacySchema(pool: RunnerPool): Promise<boolean> {
  const res = await pool.query(`SELECT to_regclass('aaelink.users') AS exists`)
  const row = res.rows[0] as { exists?: unknown } | undefined
  // `to_regclass` returns the OID name (truthy) when the relation exists,
  // or NULL (falsy) when it doesn't.
  return Boolean(row?.exists)
}
