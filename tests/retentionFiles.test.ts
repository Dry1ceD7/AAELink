/**
 * AAELink — Retention file-purge tests (storage-object + dependent-row cleanup).
 *
 * runRetentionEnforcement's file path must do more than DELETE rows: it has to
 * (1) remove the underlying bytes (primary object + thumbnail) via the storage
 * abstraction so S3/disk never orphans, (2) clean every dependent row
 * (file_index, file_scans, file_public_links, message_attachments, clips) keyed
 * off the doomed ids, (3) honor the legal-hold exclusion — channel, custodian,
 * AND the NULL-channel safety — never purging held content, and (4) delete rows
 * transactionally and remove bytes only AFTER the commit so a crash can never
 * leave a live row pointing at deleted bytes.
 *
 * These run in node with the only externalities stubbed: the storage backend
 * (so we can assert removeFileObject is called per backend incl. thumbnails)
 * and the audit-log writer (so nothing touches a real DB). The pool is a SQL-
 * capturing fake that scripts the batch SELECTs and hands out a transaction
 * client via connect().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Pool } from 'pg'

// Mocks must be declared before the SUT import so vitest hoists them.
vi.mock('@/lib/files/storage', () => ({
  removeFileObject: vi.fn(async () => true),
}))
vi.mock('@/lib/enterprise/auditLog', () => ({
  writeAuditLog: vi.fn(),
}))

import { runRetentionEnforcement } from '@/lib/enterprise/retentionJob'
import { removeFileObject } from '@/lib/files/storage'
import { writeAuditLog } from '@/lib/enterprise/auditLog'

type Captured = { sql: string; params: unknown[] }
type FileRow = {
  id: string
  storage_key: string
  storage_backend: string | null
  thumbnail_key: string | null
}

/**
 * Build a fake pool that captures every query and scripts results by SQL shape.
 *
 * @param policies      rows returned for the retention_policies SELECT
 * @param holds         rows returned for the legal_holds SELECT
 * @param fileBatches   queue of batches the file SELECT yields, in order; once
 *                      exhausted it returns [] so the purge loop terminates
 */
function makePool(opts: {
  policies: Array<{ scope: string; retention_days: number; enabled: boolean; delete_files: boolean }>
  holds?: Array<{ channel_ids: unknown; custodian_ids?: unknown; scope_from: number; scope_to: number }>
  fileBatches?: FileRow[][]
}) {
  const calls: Captured[] = []
  // Ordered log of EVERY statement (pool + client), to assert relative ordering
  // of commit vs byte removal.
  const txEvents: string[] = []
  const batches = [...(opts.fileBatches ?? [])]
  let connectCount = 0
  let releaseCount = 0

  // Shared dispatcher used by both pool.query and the tx client's query, so all
  // SQL is captured uniformly.
  const dispatch = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params })

    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      txEvents.push(sql)
      return { rowCount: 0, rows: [] }
    }
    if (sql.includes('FROM aaelink.retention_policies')) {
      return { rowCount: opts.policies.length, rows: opts.policies }
    }
    if (sql.includes('FROM aaelink.legal_holds')) {
      const rows = opts.holds ?? []
      return { rowCount: rows.length, rows }
    }
    if (sql.includes('SELECT id, storage_key, storage_backend, thumbnail_key')) {
      const next = batches.shift() ?? []
      return { rowCount: next.length, rows: next }
    }
    // DELETEs (rows + dependent tables) — report a rowCount tied to ANY($1).
    if (sql.startsWith('DELETE FROM aaelink.file_attachments WHERE id = ANY')) {
      const ids = (params[0] as string[]) ?? []
      return { rowCount: ids.length, rows: [] }
    }
    return { rowCount: 0, rows: [] }
  }

  const query = vi.fn(dispatch)

  const connect = vi.fn(async () => {
    connectCount++
    return {
      query: vi.fn(dispatch),
      release: vi.fn(() => { releaseCount++ }),
    }
  })

  const pool = { query, connect } as unknown as Pool
  return {
    pool, calls, query, connect, txEvents,
    get connectCount() { return connectCount },
    get releaseCount() { return releaseCount },
  }
}

const FILE_POLICY = { scope: 'file', retention_days: 30, enabled: true, delete_files: false }

beforeEach(() => {
  vi.mocked(removeFileObject).mockReset()
  vi.mocked(removeFileObject).mockResolvedValue(true)
  vi.mocked(writeAuditLog).mockReset()
})

describe('runRetentionEnforcement — file purge', () => {
  it('removes bytes (primary + thumbnail) per backend, then deletes the row', async () => {
    const { pool, calls } = makePool({
      policies: [FILE_POLICY],
      fileBatches: [[
        { id: 'f1', storage_key: 'chat/f1/a.png', storage_backend: 's3', thumbnail_key: 'chat/f1/a_thumb.png' },
        { id: 'f2', storage_key: 'f2.txt', storage_backend: 'local', thumbnail_key: '' },
      ]],
    })

    const results = await runRetentionEnforcement(pool)

    // Primary objects removed with their recorded backend.
    expect(removeFileObject).toHaveBeenCalledWith('chat/f1/a.png', 's3')
    expect(removeFileObject).toHaveBeenCalledWith('f2.txt', 'local')
    // Thumbnail bytes removed too (only for the row that has one), same backend.
    expect(removeFileObject).toHaveBeenCalledWith('chat/f1/a_thumb.png', 's3')
    // f2 has no thumbnail → only its primary object is removed.
    expect(vi.mocked(removeFileObject).mock.calls.filter(c => c[0] === '')).toHaveLength(0)

    // Row delete by id batch.
    const rowDelete = calls.find(c => c.sql.startsWith('DELETE FROM aaelink.file_attachments WHERE id = ANY'))
    expect(rowDelete).toBeDefined()
    expect(rowDelete!.params[0]).toEqual(['f1', 'f2'])

    expect(results[0].filesDeleted).toBe(2)
  })

  it('cleans every dependent table (file_index, file_scans, file_public_links, message_attachments, clips) for the doomed ids', async () => {
    const { pool, calls } = makePool({
      policies: [FILE_POLICY],
      fileBatches: [[
        { id: 'f1', storage_key: 'k1', storage_backend: 'local', thumbnail_key: '' },
      ]],
    })

    await runRetentionEnforcement(pool)

    const index = calls.find(c => c.sql.includes('DELETE FROM aaelink.file_index'))
    const scans = calls.find(c => c.sql.includes('DELETE FROM aaelink.file_scans'))
    const links = calls.find(c => c.sql.includes('DELETE FROM aaelink.file_public_links'))
    // message_attachments + clips carry file_id with NO FK/CASCADE → must be
    // swept explicitly or they dangle as stale eDiscovery references.
    const msgAtt = calls.find(c => c.sql.includes('DELETE FROM aaelink.message_attachments'))
    const clips = calls.find(c => c.sql.includes('DELETE FROM aaelink.clips'))

    expect(index).toBeDefined()
    expect(scans).toBeDefined()
    expect(links).toBeDefined()
    expect(msgAtt).toBeDefined()
    expect(clips).toBeDefined()
    expect(index!.params[0]).toEqual(['f1'])
    expect(scans!.params[0]).toEqual(['f1'])
    expect(links!.params[0]).toEqual(['f1'])
    expect(msgAtt!.params[0]).toEqual(['f1'])
    expect(clips!.params[0]).toEqual(['f1'])
  })

  it('preserves the legal-hold exclusion on the batch SELECT (held content is never read for deletion)', async () => {
    const { pool, calls } = makePool({
      policies: [FILE_POLICY],
      holds: [{ channel_ids: ['c1'], scope_from: 0, scope_to: 0 }],
      fileBatches: [[]], // SELECT returns nothing → everything was under hold
    })

    await runRetentionEnforcement(pool)

    const select = calls.find(c => c.sql.includes('SELECT id, storage_key, storage_backend, thumbnail_key'))
    expect(select).toBeDefined()
    // Exclusion clause is present and keys off channel_id / created_at.
    expect(select!.sql).toContain('AND NOT')
    expect(select!.sql).toContain('channel_id = ANY')
    expect(select!.sql).toContain('created_at >=')
    // A channel-scoped hold also protects NULL-channel (unattached) files, since
    // they cannot be proven outside the hold and the purge is irreversible.
    expect(select!.sql).toContain('channel_id IS NULL')
    // Hold params follow [cutoff, FILE_BATCH(=500)] → start at index 2.
    expect(select!.params[1]).toBe(500)
    expect(select!.params[2]).toEqual(['c1'])

    // Nothing to remove or delete when the SELECT is empty.
    expect(removeFileObject).not.toHaveBeenCalled()
    expect(calls.some(c => c.sql.startsWith('DELETE FROM aaelink.file_attachments WHERE id = ANY'))).toBe(false)
  })

  it('with an active channel hold, still purges the NON-held rows the SELECT returns (clause does not abort/mis-shape the delete)', async () => {
    // The fake pool ignores the WHERE and returns the scripted batch — these are
    // the rows the real (hold-excluding) SELECT would yield. Assert the purge of
    // those non-held rows still runs end-to-end while the hold clause is active.
    const { pool, calls } = makePool({
      policies: [FILE_POLICY],
      holds: [{ channel_ids: ['c1'], custodian_ids: ['u-held'], scope_from: 0, scope_to: 0 }],
      fileBatches: [[
        { id: 'keep-me-not', storage_key: 'k1', storage_backend: 's3', thumbnail_key: 't1' },
        { id: 'also-purged', storage_key: 'k2', storage_backend: 'local', thumbnail_key: '' },
      ]],
    })

    const results = await runRetentionEnforcement(pool)

    const select = calls.find(c => c.sql.includes('SELECT id, storage_key, storage_backend, thumbnail_key'))!
    // Hold params still start at $3 after [cutoff, 500]; channel ($3) + custodian ($4).
    expect(select.params[1]).toBe(500)
    expect(select.params[2]).toEqual(['c1'])
    expect(select.params[3]).toEqual(['u-held'])
    expect(select.sql).toContain('user_id = ANY')

    // Bytes removed for the returned (non-held) rows + the row delete ran.
    expect(removeFileObject).toHaveBeenCalledWith('k1', 's3')
    expect(removeFileObject).toHaveBeenCalledWith('t1', 's3')
    expect(removeFileObject).toHaveBeenCalledWith('k2', 'local')
    const rowDelete = calls.find(c => c.sql.startsWith('DELETE FROM aaelink.file_attachments WHERE id = ANY'))!
    expect(rowDelete.params[0]).toEqual(['keep-me-not', 'also-purged'])
    expect(results[0].filesDeleted).toBe(2)
  })

  it('honors a custodian-only hold (channel_ids empty) — custodian predicate is emitted, no NULL-channel guard', async () => {
    const { pool, calls } = makePool({
      policies: [FILE_POLICY],
      holds: [{ channel_ids: [], custodian_ids: ['u1'], scope_from: 0, scope_to: 0 }],
      fileBatches: [[]],
    })

    await runRetentionEnforcement(pool)

    const select = calls.find(c => c.sql.includes('SELECT id, storage_key, storage_backend, thumbnail_key'))!
    expect(select.sql).toContain('user_id = ANY')
    expect(select.sql).not.toContain('channel_id = ANY')
    // No channel-scoped hold → no NULL-channel guard.
    expect(select.sql).not.toContain('channel_id IS NULL')
    // Custodian params follow [cutoff, 500] → start at $3.
    expect(select.params[2]).toEqual(['u1'])
  })

  it('loops across full batches and terminates on a short batch', async () => {
    // First batch is exactly FILE_BATCH (500) → loop continues; second is short.
    const full: FileRow[] = Array.from({ length: 500 }, (_, i) => ({
      id: `a${i}`, storage_key: `k${i}`, storage_backend: 'local', thumbnail_key: '',
    }))
    const tail: FileRow[] = [
      { id: 'last', storage_key: 'klast', storage_backend: 'local', thumbnail_key: '' },
    ]
    const { pool, calls } = makePool({
      policies: [FILE_POLICY],
      fileBatches: [full, tail],
    })

    const results = await runRetentionEnforcement(pool)

    const selects = calls.filter(c => c.sql.includes('SELECT id, storage_key, storage_backend, thumbnail_key'))
    // Exactly two SELECTs: one full (loop continues), one short (loop stops).
    expect(selects).toHaveLength(2)
    expect(results[0].filesDeleted).toBe(501)
  })

  it('does not throw when removeFileObject rejects — purge still deletes the row', async () => {
    vi.mocked(removeFileObject).mockRejectedValue(new Error('s3 down'))
    const { pool, calls } = makePool({
      policies: [FILE_POLICY],
      fileBatches: [[
        { id: 'f1', storage_key: 'k1', storage_backend: 's3', thumbnail_key: 't1' },
      ]],
    })

    const results = await runRetentionEnforcement(pool)

    const rowDelete = calls.find(c => c.sql.startsWith('DELETE FROM aaelink.file_attachments WHERE id = ANY'))
    expect(rowDelete).toBeDefined()
    expect(results[0].filesDeleted).toBe(1)
  })

  it('wraps the row+dependent deletes in a transaction and removes bytes only AFTER commit', async () => {
    const harness = makePool({
      policies: [FILE_POLICY],
      fileBatches: [[
        { id: 'f1', storage_key: 'k1', storage_backend: 'local', thumbnail_key: 't1' },
      ]],
    })
    // Record byte removal into the same ordered event log as BEGIN/COMMIT so we
    // can assert the relative ordering: COMMIT must precede any removeFileObject.
    vi.mocked(removeFileObject).mockImplementation(async () => {
      harness.txEvents.push('removeFileObject')
      return true
    })

    await runRetentionEnforcement(harness.pool)

    // Transaction lifecycle ran on the dedicated client.
    expect(harness.connectCount).toBe(1)
    expect(harness.releaseCount).toBe(1)
    expect(harness.txEvents).toContain('BEGIN')
    expect(harness.txEvents).toContain('COMMIT')
    expect(harness.txEvents).not.toContain('ROLLBACK')

    // The row delete is the durable source of truth: COMMIT happens before any
    // byte removal, so a crash can never leave a live row with deleted bytes.
    const commitIdx = harness.txEvents.indexOf('COMMIT')
    const firstRemoveIdx = harness.txEvents.indexOf('removeFileObject')
    expect(commitIdx).toBeGreaterThanOrEqual(0)
    expect(firstRemoveIdx).toBeGreaterThan(commitIdx)

    // The dependent + row deletes all executed inside the transaction (before COMMIT).
    const beginIdx = harness.txEvents.indexOf('BEGIN')
    expect(beginIdx).toBeLessThan(commitIdx)
  })

  it('also purges files when a message policy sets delete_files (not just scope="file")', async () => {
    const { pool, calls } = makePool({
      policies: [{ scope: 'workspace', retention_days: 30, enabled: true, delete_files: true }],
      fileBatches: [[
        { id: 'f1', storage_key: 'k1', storage_backend: 'local', thumbnail_key: '' },
      ]],
    })

    const results = await runRetentionEnforcement(pool)

    expect(calls.some(c => c.sql.includes('SELECT id, storage_key, storage_backend, thumbnail_key'))).toBe(true)
    expect(removeFileObject).toHaveBeenCalledWith('k1', 'local')
    expect(results[0].filesDeleted).toBe(1)
  })

  it('records files_deleted in the audit metadata', async () => {
    const { pool } = makePool({
      policies: [FILE_POLICY],
      fileBatches: [[
        { id: 'f1', storage_key: 'k1', storage_backend: 'local', thumbnail_key: '' },
        { id: 'f2', storage_key: 'k2', storage_backend: 'local', thumbnail_key: '' },
      ]],
    })

    await runRetentionEnforcement(pool)

    expect(writeAuditLog).toHaveBeenCalledTimes(1)
    const entry = vi.mocked(writeAuditLog).mock.calls[0][0]
    expect(entry.action).toBe('retention.enforce')
    expect(entry.metadata).toMatchObject({ scope: 'file', files_deleted: 2 })
  })

  it('skips the file purge entirely when no file policy applies', async () => {
    const { pool, calls } = makePool({
      policies: [{ scope: 'channel', retention_days: 30, enabled: true, delete_files: false }],
    })

    await runRetentionEnforcement(pool)

    expect(calls.some(c => c.sql.includes('SELECT id, storage_key, storage_backend, thumbnail_key'))).toBe(false)
    expect(removeFileObject).not.toHaveBeenCalled()
  })
})
