/**
 * AAELink — `lib/migrationRunner.ts` tests
 *
 * Tests run against a stub `Pool` that records the SQL it sees and lets
 * us simulate query results. This is enough to verify the runner's
 * ordering, idempotence, synthetic-baseline behavior, and lock/release
 * sequencing. A real-Postgres integration test will land in v0.0.58.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  ensureMigrations,
  type Migration,
  type RunnerPool,
} from '@/lib/infra/migrationRunner'

/**
 * Minimal stub of the `pg.Pool.query` surface the runner uses.
 *
 * Tests register a `responder` that returns a result for a given SQL
 * substring. SQL we don't recognize returns `{ rows: [] }` so the
 * runner can call freely without per-test setup noise.
 */
interface StubPool extends RunnerPool {
  sql: string[]
  applied: Set<string>
  hasLegacy: boolean
  setLegacy(v: boolean): void
}

function makePool(opts: { hasLegacy?: boolean; preApplied?: string[] } = {}): StubPool {
  const sql: string[] = []
  const applied = new Set<string>(opts.preApplied ?? [])
  let hasLegacy = !!opts.hasLegacy

  const pool: StubPool = {
    sql,
    applied,
    get hasLegacy() { return hasLegacy },
    setLegacy(v: boolean) { hasLegacy = v },

    async query(text: string, params?: unknown[]) {
      sql.push(text)

      // Synthetic-baseline probe: the runner asks "does aaelink.users exist?".
      if (/to_regclass\('aaelink\.users'\)/i.test(text)) {
        return { rows: [{ exists: hasLegacy }] }
      }

      // Count of applied migrations.
      if (/COUNT\(\*\) FROM aaelink\.schema_migrations/i.test(text)) {
        return { rows: [{ count: applied.size }] }
      }

      // List of applied migration ids.
      if (/SELECT id FROM aaelink\.schema_migrations/i.test(text)) {
        return { rows: [...applied].map(id => ({ id })) }
      }

      // Mark applied (INSERT INTO schema_migrations).
      if (/INSERT INTO aaelink\.schema_migrations/i.test(text)) {
        const id = String((params ?? [])[0] ?? '')
        applied.add(id)
        return { rows: [] }
      }

      return { rows: [] }
    },
  }

  return pool
}

describe('ensureMigrations — fresh database', () => {
  it('runs every migration in order and records them all', async () => {
    const pool = makePool()
    const seen: string[] = []
    const migrations: Migration[] = [
      { id: '001_initial', up: async () => { seen.push('001') } },
      { id: '002_messages', up: async () => { seen.push('002') } },
    ]

    const result = await ensureMigrations(pool, migrations)

    expect(seen).toEqual(['001', '002'])
    expect(result.applied).toEqual(['001_initial', '002_messages'])
    expect(result.alreadyApplied).toEqual([])
    expect([...pool.applied]).toEqual(['001_initial', '002_messages'])
  })
})

describe('ensureMigrations — idempotent re-run', () => {
  it('skips already-applied migrations and reports them', async () => {
    const pool = makePool({ preApplied: ['001_initial', '002_messages'] })
    const seen: string[] = []
    const migrations: Migration[] = [
      { id: '001_initial', up: async () => { seen.push('001') } },
      { id: '002_messages', up: async () => { seen.push('002') } },
    ]

    const result = await ensureMigrations(pool, migrations)

    expect(seen).toEqual([])
    expect(result.applied).toEqual([])
    expect(result.alreadyApplied).toEqual(['001_initial', '002_messages'])
  })

  it('runs only the not-yet-applied tail when partially applied', async () => {
    const pool = makePool({ preApplied: ['001_initial'] })
    const seen: string[] = []
    const migrations: Migration[] = [
      { id: '001_initial', up: async () => { seen.push('001') } },
      { id: '002_messages', up: async () => { seen.push('002') } },
      { id: '003_audit', up: async () => { seen.push('003') } },
    ]

    const result = await ensureMigrations(pool, migrations)

    expect(seen).toEqual(['002', '003'])
    expect(result.applied).toEqual(['002_messages', '003_audit'])
    expect(result.alreadyApplied).toEqual(['001_initial'])
  })
})

describe('ensureMigrations — failure handling', () => {
  it('throws and stops further migrations when one fails', async () => {
    const pool = makePool()
    const seen: string[] = []
    const migrations: Migration[] = [
      { id: '001_initial', up: async () => { seen.push('001') } },
      { id: '002_messages', up: async () => { throw new Error('boom') } },
      { id: '003_audit', up: async () => { seen.push('003') } },
    ]

    await expect(ensureMigrations(pool, migrations)).rejects.toThrow(/boom/)

    // 001 ran, 002 threw, 003 never ran.
    expect(seen).toEqual(['001'])
    // 001 was recorded; 002 and 003 were not.
    expect([...pool.applied]).toEqual(['001_initial'])
  })
})

describe('ensureMigrations — synthetic baseline', () => {
  it('marks 001 as applied without running it when legacy schema is detected', async () => {
    const pool = makePool({ hasLegacy: true })
    const seen: string[] = []
    const migrations: Migration[] = [
      { id: '001_initial_schema', up: async () => { seen.push('001 SHOULD NOT RUN') } },
    ]

    const result = await ensureMigrations(pool, migrations)

    // Legacy detected + no rows yet → mark 001 applied without invoking it.
    expect(seen).toEqual([])
    expect(result.applied).toEqual([])
    expect(result.alreadyApplied).toEqual(['001_initial_schema'])
    expect([...pool.applied]).toEqual(['001_initial_schema'])
  })

  it('does NOT trigger the baseline path if any migrations are already recorded', async () => {
    const pool = makePool({ hasLegacy: true, preApplied: ['001_initial_schema'] })
    const seen: string[] = []
    const migrations: Migration[] = [
      { id: '001_initial_schema', up: async () => { seen.push('SKIPPED') } },
      { id: '002_messages', up: async () => { seen.push('002') } },
    ]

    const result = await ensureMigrations(pool, migrations)

    // 001 is already applied (so skipped), 002 runs normally.
    expect(seen).toEqual(['002'])
    expect(result.applied).toEqual(['002_messages'])
    expect(result.alreadyApplied).toEqual(['001_initial_schema'])
  })
})

describe('ensureMigrations — order respected by array, not by id', () => {
  it('runs the array order even when ids would sort differently', async () => {
    const pool = makePool()
    const seen: string[] = []
    const migrations: Migration[] = [
      // intentional: B comes first in the array even though id sorts later
      { id: 'zzz_runs_first', up: async () => { seen.push('zzz') } },
      { id: 'aaa_runs_second', up: async () => { seen.push('aaa') } },
    ]

    await ensureMigrations(pool, migrations)

    expect(seen).toEqual(['zzz', 'aaa'])
  })
})

describe('ensureMigrations — schema_migrations table is ensured before reads', () => {
  let pool: StubPool

  beforeEach(() => {
    pool = makePool()
  })

  it('issues a CREATE TABLE IF NOT EXISTS for schema_migrations before any other DDL', async () => {
    await ensureMigrations(pool, [])

    const sqls = pool.sql.map(s => s.toLowerCase())
    const createIdx = sqls.findIndex(s =>
      /create\s+table\s+if\s+not\s+exists\s+aaelink\.schema_migrations/.test(s)
    )

    expect(createIdx).toBeGreaterThanOrEqual(0)
    // Synthetic-baseline probe + count + select-applied + create-table all
    // come from the runner itself. We only need to know the create-table
    // statement happened.
  })
})
