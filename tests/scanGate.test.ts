/**
 * AAELink — scan-policy merge tests (single source of truth).
 *
 * lib/files/scanGate.ts owns the ONE enforced ScanPolicy shape. getScanPolicy /
 * setScanPolicy must:
 *   - load EITHER legacy JSON shape stored at system_config['file_scan_policy']
 *     safely — the original gate shape { block_infected, block_unscanned } and
 *     the old route shape { enabled, scan_on_upload, quarantine_infected,
 *     max_file_size_mb, blocked_extensions, scan_engine,
 *     auto_delete_infected_after_days } — ignoring decorative legacy keys;
 *   - NEVER let stored JSON unset block_infected (pinned true);
 *   - normalize blocked_extensions (lowercase, dot-prefixed, de-duped);
 *   - merge defaults for any absent field.
 *
 * These run in node with a SQL-capturing fake pool that emulates the single
 * system_config row — no real DB (mirrors tests/retentionFiles.test.ts).
 */
import { describe, it, expect } from 'vitest'
import type { Pool } from 'pg'
import {
  getScanPolicy,
  setScanPolicy,
  DEFAULT_SCAN_POLICY,
} from '@/lib/files/scanGate'

/**
 * Fake pool emulating system_config as a one-row key/value store. The SELECT
 * returns whatever was last written (or the seeded `stored` value); the
 * INSERT…ON CONFLICT upserts the JSON string so a get-after-set round-trips.
 */
function makePool(stored?: string) {
  let value: string | undefined = stored
  const query = async (sql: string, params: unknown[] = []) => {
    if (sql.includes('SELECT value FROM aaelink.system_config')) {
      return value === undefined ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ value }] }
    }
    if (sql.includes('INSERT INTO aaelink.system_config')) {
      value = params[1] as string
      return { rowCount: 1, rows: [] }
    }
    return { rowCount: 0, rows: [] }
  }
  return { query } as unknown as Pool
}

describe('getScanPolicy — defaults', () => {
  it('returns DEFAULT_SCAN_POLICY when nothing is stored', async () => {
    const p = await getScanPolicy(makePool())
    expect(p).toEqual(DEFAULT_SCAN_POLICY)
    expect(p.block_infected).toBe(true)
    expect(p.block_unscanned).toBe(false)
    expect(p.scan_on_upload).toBe(true)
    expect(p.max_file_size_mb).toBe(0)
    expect(p.blocked_extensions).toEqual([])
    expect(p.auto_delete_infected_after_days).toBe(0)
  })

  it('falls back to defaults on unparseable stored JSON', async () => {
    const p = await getScanPolicy(makePool('}{not json'))
    expect(p).toEqual(DEFAULT_SCAN_POLICY)
  })
})

describe('getScanPolicy — legacy gate shape', () => {
  it('loads { block_infected, block_unscanned } safely and fills new defaults', async () => {
    const stored = JSON.stringify({ block_infected: true, block_unscanned: true })
    const p = await getScanPolicy(makePool(stored))
    expect(p.block_unscanned).toBe(true)
    // New superset fields default in.
    expect(p.scan_on_upload).toBe(true)
    expect(p.max_file_size_mb).toBe(0)
    expect(p.blocked_extensions).toEqual([])
    expect(p.auto_delete_infected_after_days).toBe(0)
    expect(p.block_infected).toBe(true)
  })

  it('never lets stored block_infected:false unset the pin', async () => {
    const stored = JSON.stringify({ block_infected: false, block_unscanned: false })
    const p = await getScanPolicy(makePool(stored))
    expect(p.block_infected).toBe(true)
  })
})

describe('getScanPolicy — legacy route shape', () => {
  it('maps the rich route shape, ignoring decorative keys (enabled, quarantine_infected, scan_engine)', async () => {
    const stored = JSON.stringify({
      enabled: false, // ignored
      scan_on_upload: false,
      quarantine_infected: false, // ignored
      max_file_size_mb: 100,
      blocked_extensions: ['.EXE', 'bat', '.exe'], // un-normalized + dup
      scan_engine: 'clamav', // ignored
      auto_delete_infected_after_days: 30,
    })
    const p = await getScanPolicy(makePool(stored))
    expect(p.scan_on_upload).toBe(false)
    expect(p.max_file_size_mb).toBe(100)
    expect(p.auto_delete_infected_after_days).toBe(30)
    // Normalized: lowercase, dot-prefixed, de-duped.
    expect(p.blocked_extensions).toEqual(['.exe', '.bat'])
    // Decorative keys do not leak onto the typed shape.
    expect((p as unknown as Record<string, unknown>).enabled).toBeUndefined()
    expect((p as unknown as Record<string, unknown>).quarantine_infected).toBeUndefined()
    expect((p as unknown as Record<string, unknown>).scan_engine).toBeUndefined()
    // block_infected always enforced even though the legacy shape omits it.
    expect(p.block_infected).toBe(true)
  })
})

describe('setScanPolicy', () => {
  it('round-trips a patch, merging onto current and pinning block_infected', async () => {
    const pool = makePool()
    const updated = await setScanPolicy(pool, { block_unscanned: true, max_file_size_mb: 25 })
    expect(updated.block_unscanned).toBe(true)
    expect(updated.max_file_size_mb).toBe(25)
    expect(updated.block_infected).toBe(true)
    // Untouched fields stay at defaults.
    expect(updated.scan_on_upload).toBe(true)

    const reread = await getScanPolicy(pool)
    expect(reread.block_unscanned).toBe(true)
    expect(reread.max_file_size_mb).toBe(25)
  })

  it('keeps block_infected forced true even if patched false', async () => {
    const pool = makePool()
    const updated = await setScanPolicy(pool, { block_infected: false } as never)
    expect(updated.block_infected).toBe(true)
    expect((await getScanPolicy(pool)).block_infected).toBe(true)
  })

  it('normalizes blocked_extensions on write (lowercase, dot, de-dupe, drop blanks)', async () => {
    const pool = makePool()
    const updated = await setScanPolicy(pool, {
      blocked_extensions: ['.EXE', 'BAT', '', '   ', '.exe', '.scr'],
    } as never)
    expect(updated.blocked_extensions).toEqual(['.exe', '.bat', '.scr'])
  })

  it('clamps negative / fractional numbers to a non-negative integer', async () => {
    const pool = makePool()
    const updated = await setScanPolicy(pool, {
      max_file_size_mb: -5,
      auto_delete_infected_after_days: 7.9,
    } as never)
    expect(updated.max_file_size_mb).toBe(0)
    expect(updated.auto_delete_infected_after_days).toBe(7)
  })

  it('preserves prior stored fields when patching a single flag (no clobber)', async () => {
    // Seed a rich legacy-route JSON, then flip only block_unscanned.
    const stored = JSON.stringify({
      scan_on_upload: false,
      max_file_size_mb: 100,
      blocked_extensions: ['.exe'],
      auto_delete_infected_after_days: 30,
    })
    const pool = makePool(stored)
    const updated = await setScanPolicy(pool, { block_unscanned: true })
    // The patched flag changed…
    expect(updated.block_unscanned).toBe(true)
    // …and the previously-stored fields survived (the route can no longer
    // clobber the enforced flags by writing a partial/decorative shape).
    expect(updated.scan_on_upload).toBe(false)
    expect(updated.max_file_size_mb).toBe(100)
    expect(updated.blocked_extensions).toEqual(['.exe'])
    expect(updated.auto_delete_infected_after_days).toBe(30)
    expect(updated.block_infected).toBe(true)
  })
})
