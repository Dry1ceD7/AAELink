/**
 * Unit tests for lib/files/uploadSessions.ts — the resumable upload engine.
 *
 * These run in node with NO real DB / S3, using SQL-capturing fake pools
 * (mirroring tests/scanGate.test.ts) for:
 *   - part math (expectedPartCount: exact multiples, remainders, zero/negative)
 *   - size validation at create (declared_size <= 0 / non-integer / over cap)
 *   - per-user active-session cap (too_many_active_sessions)
 *   - parts_missing detection at complete
 *   - complete claims status FIRST (active-guarded), idempotent loser path
 *   - sweep batching (per-batch LIMIT bound + multi-batch drain)
 *
 * FS ISOLATION: lib/files/storage.ts resolves UPLOAD_DIR ONCE at module load, so
 * an `process.env.AAELINK_UPLOAD_DIR` mutation in beforeEach is dead code (it
 * cannot move the frozen const). Instead we mock `fs/promises` entirely, so the
 * local-backend create/append/abort branches touch NO real disk and never
 * pollute the repo working tree. The previous version leaked a real .part file
 * per create into <cwd>/.uploads.
 *
 * Full end-to-end (create → out-of-order parts → complete) is covered by the
 * live-PG integration test __tests__/api/upload-sessions.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Pool } from 'pg'

// ── fs/promises mock — keep ALL local-backend fs work in memory ───────────
// A minimal in-memory file table keyed by absolute path. Only the operations
// the engine's local branch uses are implemented.
const fsFiles = new Map<string, Buffer>()
vi.mock('fs/promises', () => {
  const mkdir = vi.fn(async () => undefined)
  const writeFile = vi.fn(async (p: string, data: Buffer) => {
    fsFiles.set(String(p), Buffer.from(data))
  })
  const unlink = vi.fn(async (p: string) => {
    if (!fsFiles.has(String(p))) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    fsFiles.delete(String(p))
  })
  const stat = vi.fn(async (p: string) => {
    const b = fsFiles.get(String(p))
    if (!b) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    return { size: b.length }
  })
  const rename = vi.fn(async (from: string, to: string) => {
    const b = fsFiles.get(String(from))
    if (!b) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    fsFiles.set(String(to), b)
    fsFiles.delete(String(from))
  })
  const open = vi.fn(async (p: string) => {
    if (!fsFiles.has(String(p))) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    return {
      write: vi.fn(async (buf: Buffer, _o: number, len: number, offset: number) => {
        const cur = fsFiles.get(String(p)) || Buffer.alloc(0)
        const end = offset + len
        const grown = end > cur.length ? Buffer.concat([cur, Buffer.alloc(end - cur.length)]) : Buffer.from(cur)
        buf.copy(grown, offset, 0, len)
        fsFiles.set(String(p), grown)
        return { bytesWritten: len }
      }),
      close: vi.fn(async () => undefined),
    }
  })
  const api = { mkdir, writeFile, unlink, stat, rename, open }
  return { ...api, default: api }
})

import nodePath from 'path'
import {
  expectedPartCount,
  createUploadSession,
  completeUploadSession,
  abortUploadSession,
  sweepExpiredUploadSessions,
  UploadSessionError,
  PART_SIZE,
  MAX_ACTIVE_SESSIONS_PER_USER,
  SWEEP_BATCH_SIZE,
} from '@/lib/files/uploadSessions'
import { MULTIPART_MAX_BYTES } from '@/lib/files/uploadPolicy'
import { UPLOAD_DIR } from '@/lib/files/storage'

let savedEndpoint: string | undefined

beforeEach(() => {
  // Force the local backend (no S3) for all unit tests.
  savedEndpoint = process.env.S3_ENDPOINT
  delete process.env.S3_ENDPOINT
  fsFiles.clear()
})

afterEach(() => {
  if (savedEndpoint === undefined) delete process.env.S3_ENDPOINT
  else process.env.S3_ENDPOINT = savedEndpoint
})

// ── expectedPartCount ────────────────────────────────────────────────

describe('expectedPartCount', () => {
  it('returns 1 for a file smaller than one part', () => {
    expect(expectedPartCount(1, PART_SIZE)).toBe(1)
    expect(expectedPartCount(PART_SIZE - 1, PART_SIZE)).toBe(1)
  })
  it('returns 1 for an exact single part', () => {
    expect(expectedPartCount(PART_SIZE, PART_SIZE)).toBe(1)
  })
  it('rounds up a remainder to an extra final part', () => {
    expect(expectedPartCount(PART_SIZE + 1, PART_SIZE)).toBe(2)
    expect(expectedPartCount(PART_SIZE * 2 - 1, PART_SIZE)).toBe(2)
  })
  it('handles exact multiples', () => {
    expect(expectedPartCount(PART_SIZE * 3, PART_SIZE)).toBe(3)
  })
  it('returns 0 for non-positive declared sizes', () => {
    expect(expectedPartCount(0, PART_SIZE)).toBe(0)
    expect(expectedPartCount(-1, PART_SIZE)).toBe(0)
  })
})

// ── Fake pool helpers ─────────────────────────────────────────────────

interface SessionState {
  rows: Record<string, Record<string, unknown>>
}

/**
 * Fake pool that emulates the bits of aaelink.upload_sessions /
 * aaelink.channels / aaelink.system_config the engine touches. Each session row
 * is stored as a plain object keyed by id; SELECT ${SELECT_COLS} returns it
 * back with the ::text-cast bigints already strings.
 */
function makePool(seed: SessionState = { rows: {} }): Pool & { _state: SessionState } {
  const state = seed
  const query = async (sql: string, params: unknown[] = []) => {
    // Scan policy lookups → default (nothing stored).
    if (sql.includes('SELECT value FROM aaelink.system_config')) {
      return { rowCount: 0, rows: [] }
    }
    // Per-user active session count (cap check at create).
    if (sql.includes('count(*)') && sql.includes("status = 'active'") && sql.includes('user_id = $1')) {
      const uid = params[0]
      const count = Object.values(state.rows)
        .filter((r) => r.user_id === uid && r.status === 'active').length
      return { rowCount: 1, rows: [{ count: String(count) }] }
    }
    // Channel → workspace resolution.
    if (sql.includes('FROM aaelink.channels WHERE id')) {
      return { rowCount: 0, rows: [] }
    }
    // INSERT a new session. Column order now includes `version` before created_at.
    if (sql.includes('INSERT INTO aaelink.upload_sessions')) {
      const [
        id, user_id, workspace_id, channel_id, filename, content_type, declared_size,
        part_size, backend, s3_upload_id, storage_key, file_id, created_at, expires_at,
      ] = params
      state.rows[String(id)] = {
        id, user_id, workspace_id, channel_id, filename, content_type,
        declared_size: String(declared_size), received_bytes: '0',
        part_size, parts_received: [], backend, s3_upload_id, s3_parts: [],
        storage_key, status: 'active', file_id, version: 0,
        created_at: String(created_at), updated_at: String(created_at),
        expires_at: String(expires_at),
      }
      return { rowCount: 1, rows: [] }
    }
    // SELECT one session by id.
    if (sql.includes('FROM aaelink.upload_sessions WHERE id')) {
      const row = state.rows[String(params[0])]
      return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] }
    }
    // Sweep scan: active + expired, LIMIT N.
    if (sql.includes("WHERE status = 'active' AND expires_at <")) {
      const now = Number(params[0])
      const matched = Object.values(state.rows)
        .filter((r) => r.status === 'active' && Number(r.expires_at) < now)
        .sort((a, b) => Number(a.expires_at) - Number(b.expires_at))
        .slice(0, SWEEP_BATCH_SIZE)
      return { rowCount: matched.length, rows: matched }
    }
    // Guarded status flips (sweep / complete / abort).
    if (sql.includes('UPDATE aaelink.upload_sessions') && sql.includes("status = 'expired'")) {
      const row = state.rows[String(params[1])]
      if (row && row.status === 'active') { row.status = 'expired'; return { rowCount: 1, rows: [] } }
      return { rowCount: 0, rows: [] }
    }
    if (sql.includes('UPDATE aaelink.upload_sessions') && sql.includes("status = 'completed'")) {
      const row = state.rows[String(params[1])]
      if (row && row.status === 'active') { row.status = 'completed'; return { rowCount: 1, rows: [] } }
      return { rowCount: 0, rows: [] }
    }
    if (sql.includes('UPDATE aaelink.upload_sessions') && sql.includes("status = 'aborted'")) {
      const row = state.rows[String(params[1])]
      if (row && row.status === 'active') { row.status = 'aborted'; return { rowCount: 1, rows: [] } }
      return { rowCount: 0, rows: [] }
    }
    // appendPart version-guarded UPDATE.
    if (sql.includes('UPDATE aaelink.upload_sessions') && sql.includes('version = version + 1')) {
      const [received, parts, s3parts, updatedAt, id, prevVersion] = params
      const row = state.rows[String(id)]
      if (row && row.status === 'active' && Number(row.version) === Number(prevVersion)) {
        row.received_bytes = String(received)
        row.parts_received = JSON.parse(String(parts))
        row.s3_parts = JSON.parse(String(s3parts))
        row.updated_at = String(updatedAt)
        row.version = Number(row.version) + 1
        return { rowCount: 1, rows: [] }
      }
      return { rowCount: 0, rows: [] }
    }
    // Audit log writes / pipeline enqueue / file_attachments insert → no-op.
    return { rowCount: 0, rows: [] }
  }
  return Object.assign({ query }, { _state: state }) as unknown as Pool & { _state: SessionState }
}

// ── createUploadSession — size validation ─────────────────────────────

describe('createUploadSession — declared size validation', () => {
  const base = { uid: 'u1', filename: 'big.bin', contentType: 'application/octet-stream' }

  it('rejects declared_size <= 0', async () => {
    await expect(createUploadSession(makePool(), { ...base, declaredSize: 0 }))
      .rejects.toMatchObject({ code: 'invalid_declared_size', status: 400 })
    await expect(createUploadSession(makePool(), { ...base, declaredSize: -5 }))
      .rejects.toMatchObject({ code: 'invalid_declared_size', status: 400 })
  })

  it('rejects a non-integer declared_size', async () => {
    await expect(createUploadSession(makePool(), { ...base, declaredSize: 1.5 }))
      .rejects.toMatchObject({ code: 'invalid_declared_size', status: 400 })
    await expect(createUploadSession(makePool(), { ...base, declaredSize: NaN }))
      .rejects.toMatchObject({ code: 'invalid_declared_size', status: 400 })
  })

  it('rejects a size over the 5 GB multipart ceiling', async () => {
    await expect(createUploadSession(makePool(), { ...base, declaredSize: MULTIPART_MAX_BYTES + 1 }))
      .rejects.toMatchObject({ code: 'file_too_large', status: 413 })
  })

  it('rejects an empty filename', async () => {
    await expect(createUploadSession(makePool(), { ...base, filename: '   ', declaredSize: 100 }))
      .rejects.toMatchObject({ code: 'filename_required', status: 400 })
  })

  it('accepts a valid small file and seeds part_size + active status', async () => {
    const pool = makePool()
    const s = await createUploadSession(pool, { ...base, declaredSize: 100 })
    expect(s.part_size).toBe(PART_SIZE)
    expect(s.status).toBe('active')
    expect(s.parts_received).toEqual([])
    expect(Number(s.declared_size)).toBe(100)
    expect(s.backend).toBe('local')
    expect(s.version).toBe(0)
    // file_id is generated up front and distinct from the session id.
    expect(s.file_id).toBeTruthy()
    expect(s.file_id).not.toBe(s.id)
    // The local partial was created in the in-memory fs (no real disk write).
    expect(fsFiles.size).toBe(1)
  })
})

// ── createUploadSession — per-user active-session cap ──────────────────

describe('createUploadSession — per-user concurrent-session cap', () => {
  const base = { uid: 'capuser', filename: 'c.bin', contentType: 'application/octet-stream' }

  it('rejects the (max+1)th active session with 429 too_many_active_sessions', async () => {
    const pool = makePool()
    // Open exactly the max number of active sessions for the user.
    for (let i = 0; i < MAX_ACTIVE_SESSIONS_PER_USER; i++) {
      await createUploadSession(pool, { ...base, declaredSize: 100 })
    }
    // The next create must be rejected before allocating storage.
    await expect(createUploadSession(pool, { ...base, declaredSize: 100 }))
      .rejects.toMatchObject({ code: 'too_many_active_sessions', status: 429, extra: { max_active: MAX_ACTIVE_SESSIONS_PER_USER } })
  })

  it('does not count another user toward the cap', async () => {
    const pool = makePool()
    for (let i = 0; i < MAX_ACTIVE_SESSIONS_PER_USER; i++) {
      await createUploadSession(pool, { ...base, declaredSize: 100 })
    }
    // A different user is unaffected by capuser's open sessions.
    const other = await createUploadSession(pool, { uid: 'otheruser', filename: 'o.bin', declaredSize: 100 })
    expect(other.status).toBe('active')
  })

  it('frees a slot once a session is no longer active (aborted)', async () => {
    const pool = makePool()
    const ids: string[] = []
    for (let i = 0; i < MAX_ACTIVE_SESSIONS_PER_USER; i++) {
      ids.push((await createUploadSession(pool, { ...base, declaredSize: 100 })).id)
    }
    // Abort one → drops below the cap → next create succeeds.
    await abortUploadSession(pool, { sessionId: ids[0], uid: base.uid })
    const again = await createUploadSession(pool, { ...base, declaredSize: 100 })
    expect(again.status).toBe('active')
  })
})

// ── createUploadSession — INSERT-failure storage cleanup ───────────────

describe('createUploadSession — failed INSERT releases staged storage', () => {
  it('unlinks the local partial when the INSERT throws (no orphan)', async () => {
    // A pool whose INSERT always fails. The per-user count query returns 0.
    const failingPool = {
      query: async (sql: string) => {
        if (sql.includes('SELECT value FROM aaelink.system_config')) return { rowCount: 0, rows: [] }
        if (sql.includes('count(*)')) return { rowCount: 1, rows: [{ count: '0' }] }
        if (sql.includes('FROM aaelink.channels WHERE id')) return { rowCount: 0, rows: [] }
        if (sql.includes('INSERT INTO aaelink.upload_sessions')) throw new Error('db_insert_failed')
        return { rowCount: 0, rows: [] }
      },
    } as unknown as Pool

    await expect(
      createUploadSession(failingPool, { uid: 'u1', filename: 'x.bin', declaredSize: 100 })
    ).rejects.toThrow('db_insert_failed')
    // The pre-created local partial must have been unlinked → nothing leaked.
    expect(fsFiles.size).toBe(0)
  })
})

// ── completeUploadSession — parts_missing detection ───────────────────

describe('completeUploadSession — parts_missing', () => {
  it('reports the exact missing part numbers when not all parts arrived', async () => {
    const pool = makePool()
    // 3-part file; only parts 1 and 3 present.
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const declared = PART_SIZE * 2 + 10
    pool._state.rows[id] = {
      id, user_id: 'u1', workspace_id: null, channel_id: null,
      filename: 'f.bin', content_type: '', declared_size: String(declared),
      received_bytes: String(PART_SIZE + 10), part_size: PART_SIZE,
      parts_received: [1, 3], backend: 'local', s3_upload_id: '', s3_parts: [],
      storage_key: 'x.bin', status: 'active', file_id: 'fid', version: 0,
      created_at: '1', updated_at: '1', expires_at: String(Date.now() + 1000),
    }
    await expect(completeUploadSession(pool, { sessionId: id, uid: 'u1' }))
      .rejects.toMatchObject({ code: 'parts_missing', status: 409, extra: { missing: [2] } })
    // parts_missing is detected BEFORE the status claim → session stays active.
    expect(pool._state.rows[id].status).toBe('active')
  })

  it('rejects a non-owner with 403 before any storage work', async () => {
    const pool = makePool()
    const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    pool._state.rows[id] = {
      id, user_id: 'owner', workspace_id: null, channel_id: null,
      filename: 'f.bin', content_type: '', declared_size: '100',
      received_bytes: '0', part_size: PART_SIZE, parts_received: [],
      backend: 'local', s3_upload_id: '', s3_parts: [], storage_key: 'x.bin',
      status: 'active', file_id: 'fid', version: 0, created_at: '1', updated_at: '1',
      expires_at: String(Date.now() + 1000),
    }
    await expect(completeUploadSession(pool, { sessionId: id, uid: 'intruder' }))
      .rejects.toMatchObject({ code: 'forbidden', status: 403 })
  })

  it('404s an unknown session', async () => {
    await expect(completeUploadSession(makePool(), { sessionId: 'nope', uid: 'u1' }))
      .rejects.toBeInstanceOf(UploadSessionError)
  })
})

// ── completeUploadSession — claim-first ordering (race safety) ─────────

describe('completeUploadSession — claims status before finalizing storage', () => {
  /** A single-part local session with its partial already on (in-memory) disk. */
  function seedReadySession(pool: Pool & { _state: SessionState }, id: string, storageKey: string) {
    const size = 50
    pool._state.rows[id] = {
      id, user_id: 'u1', workspace_id: null, channel_id: null,
      filename: 'r.bin', content_type: '', declared_size: String(size),
      received_bytes: String(size), part_size: PART_SIZE, parts_received: [1],
      backend: 'local', s3_upload_id: '', s3_parts: [], storage_key: storageKey,
      status: 'active', file_id: 'fid', version: 1,
      created_at: '1', updated_at: '1', expires_at: String(Date.now() + 1000),
    }
    // The assembled partial must exist at the path completeUploadSession stats.
    fsFiles.set(nodePath.join(UPLOAD_DIR, 'partial', `${id}.part`), Buffer.alloc(size, 9))
  }

  it('complete claims FIRST so a racing abort cannot release storage from under it', async () => {
    const pool = makePool()
    const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    seedReadySession(pool, id, 'final.bin')

    // Complete claims the active→completed flip up front. We then simulate a
    // racing abort arriving AFTER the claim: its active-guarded flip must lose
    // (rowCount 0 → no-op) and it must NOT unlink/rename anything.
    const completeRes = await completeUploadSession(pool, { sessionId: id, uid: 'u1' })
    expect(pool._state.rows[id].status).toBe('completed')
    // The final file exists (rename ran during complete).
    expect(fsFiles.has(nodePath.join(UPLOAD_DIR, 'final.bin'))).toBe(true)

    // A late abort cannot revert or release: status guard rejects it.
    await abortUploadSession(pool, { sessionId: id, uid: 'u1' })
    expect(pool._state.rows[id].status).toBe('completed')
    expect(fsFiles.has(nodePath.join(UPLOAD_DIR, 'final.bin'))).toBe(true)
    expect(completeRes.attachment.size).toBe(50)
  })

  it('an abort that wins the claim first makes a later complete fail cleanly (409)', async () => {
    const pool = makePool()
    const id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    seedReadySession(pool, id, 'final3.bin')

    // Abort wins the claim → status 'aborted', partial unlinked.
    await abortUploadSession(pool, { sessionId: id, uid: 'u1' })
    expect(pool._state.rows[id].status).toBe('aborted')

    // A complete arriving after sees status!=='active'/'completed' → typed 409,
    // NOT an unmapped error from CompleteMultipartUpload / a missing partial.
    await expect(completeUploadSession(pool, { sessionId: id, uid: 'u1' }))
      .rejects.toMatchObject({ code: 'session_not_active', status: 409 })
  })

  it('double-complete: the loser returns the same attachment idempotently', async () => {
    const pool = makePool()
    const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    seedReadySession(pool, id, 'final2.bin')

    const first = await completeUploadSession(pool, { sessionId: id, uid: 'u1' })
    // Second complete sees status==='completed' and returns the same attachment.
    const second = await completeUploadSession(pool, { sessionId: id, uid: 'u1' })
    expect(second.attachment.id).toBe(first.attachment.id)
    expect(pool._state.rows[id].status).toBe('completed')
  })
})

// ── sweepExpiredUploadSessions — batching + multi-batch drain ──────────

describe('sweepExpiredUploadSessions', () => {
  function activeSession(id: string, expiresAt: number) {
    return {
      id, user_id: 'u1', workspace_id: null, channel_id: null,
      filename: 'f.bin', content_type: '', declared_size: '100',
      received_bytes: '0', part_size: PART_SIZE, parts_received: [],
      backend: 'local', s3_upload_id: '', s3_parts: [], storage_key: 'x.bin',
      status: 'active', file_id: 'fid', version: 0, created_at: '1', updated_at: '1',
      expires_at: String(expiresAt),
    }
  }

  it('expires only active sessions past their TTL', async () => {
    const now = 10_000
    const pool = makePool()
    pool._state.rows = {
      '11111111-1111-4111-8111-111111111111': activeSession('11111111-1111-4111-8111-111111111111', now - 1),
      '22222222-2222-4222-8222-222222222222': activeSession('22222222-2222-4222-8222-222222222222', now + 1000),
    }
    const count = await sweepExpiredUploadSessions(pool, now)
    expect(count).toBe(1)
    expect(pool._state.rows['11111111-1111-4111-8111-111111111111'].status).toBe('expired')
    expect(pool._state.rows['22222222-2222-4222-8222-222222222222'].status).toBe('active')
  })

  it('returns 0 when nothing is expired', async () => {
    const now = 10_000
    const pool = makePool()
    pool._state.rows = {
      '33333333-3333-4333-8333-333333333333': activeSession('33333333-3333-4333-8333-333333333333', now + 5000),
    }
    expect(await sweepExpiredUploadSessions(pool, now)).toBe(0)
  })

  it('drains a backlog LARGER than one batch across multiple batches', async () => {
    const now = 1_000_000
    const pool = makePool()
    const rows: Record<string, Record<string, unknown>> = {}
    const backlog = SWEEP_BATCH_SIZE * 2 + 37 // > 2 full batches
    for (let i = 0; i < backlog; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
      rows[id] = activeSession(id, now - 1)
    }
    pool._state.rows = rows
    const count = await sweepExpiredUploadSessions(pool, now)
    // The whole backlog drains in one invocation (each batch is bounded to
    // SWEEP_BATCH_SIZE, but the outer loop keeps going until short).
    expect(count).toBe(backlog)
    // Every row ended up expired.
    expect(Object.values(pool._state.rows).every((r) => r.status === 'expired')).toBe(true)
  })

  it('each SELECT batch is bounded to SWEEP_BATCH_SIZE rows', async () => {
    const now = 2_000_000
    const pool = makePool()
    const selectSizes: number[] = []
    const realQuery = pool.query.bind(pool) as typeof pool.query
    // Spy on the sweep SELECT to assert no single batch exceeds the cap.
    pool.query = (async (sql: string, params?: unknown[]) => {
      const res = await realQuery(sql, params as never)
      if (typeof sql === 'string' && sql.includes("WHERE status = 'active' AND expires_at <")) {
        selectSizes.push(res.rows.length)
      }
      return res
    }) as typeof pool.query
    const rows: Record<string, Record<string, unknown>> = {}
    for (let i = 0; i < SWEEP_BATCH_SIZE + 50; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
      rows[id] = activeSession(id, now - 1)
    }
    pool._state.rows = rows
    await sweepExpiredUploadSessions(pool, now)
    // First batch is exactly the cap; subsequent batches never exceed it.
    expect(Math.max(...selectSizes)).toBeLessThanOrEqual(SWEEP_BATCH_SIZE)
    expect(selectSizes[0]).toBe(SWEEP_BATCH_SIZE)
  })
})
