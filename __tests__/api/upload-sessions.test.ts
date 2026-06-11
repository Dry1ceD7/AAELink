/**
 * Integration tests for the resumable / two-phase upload session subsystem.
 *
 * Slack files.getUploadURLExternal → upload parts → files.completeUploadExternal
 * parity, backed by aaelink.upload_sessions (migration 040) and the local
 * storage backend (S3 unconfigured in tests). Exercised end-to-end against a
 * live Postgres:
 *
 *   - POST   /api/files/upload-sessions          create
 *   - GET    /api/files/upload-sessions?session_id=  resume status
 *   - PUT    /api/files/upload-sessions/[id]?part=N   append raw part bytes
 *   - POST   /api/files/upload-sessions/[id]          { action: complete | abort }
 *
 * Covers: out-of-order parts, resume state, complete → file_attachments row +
 * pipeline jobs + bytes-on-disk, CSRF negative, non-owner 403, double-complete,
 * part-size mismatch 400, the create-time 5 GB ceiling 413, the engine-level
 * size_exceeded → abort backstop (413), per-user concurrent-session cap (429),
 * concurrent same-session appends (version-guarded, no lost part),
 * complete-vs-append race, duplicate-different-bytes discard, abort unlinks
 * partial, expired sweep marks + cleans.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID, createHmac } from 'crypto'
import fs from 'fs'
import path from 'path'
import {
  createTestContext,
  createTestUser,
  asRequest,
  expectSuccess,
  expectError,
  TestContext,
  TestUser,
} from '../helpers'

import { POST as SESSIONS_POST, GET as SESSIONS_GET } from '@/app/api/files/upload-sessions/route'
import { PUT as PART_PUT, POST as ACTION_POST } from '@/app/api/files/upload-sessions/[id]/route'
import {
  PART_SIZE,
  sweepExpiredUploadSessions,
  appendPart,
  completeUploadSession,
  getUploadSession,
  MAX_ACTIVE_SESSIONS_PER_USER,
} from '@/lib/files/uploadSessions'

let ctx: TestContext
let owner: TestUser
let other: TestUser
const userIds: string[] = []
const sessionIds: string[] = []
const fileIds: string[] = []

const UPLOAD_DIR = process.env.AAELINK_UPLOAD_DIR || path.join(process.cwd(), '.uploads')

/** Mint a CSRF token matching lib/auth/csrf (test secret). */
function csrfToken(): string {
  const secret = process.env.CSRF_SECRET || 'test-csrf-secret'
  const raw = randomUUID().replace(/-/g, '')
  const sig = createHmac('sha256', secret).update(raw).digest('hex').slice(0, 16)
  return `${raw}.${sig}`
}

type PutReq = Parameters<typeof PART_PUT>[0]
type ActionReq = Parameters<typeof ACTION_POST>[0]
const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) })

/**
 * Build a raw-body PUT request for a part (NOT multipart). Sets the test cookie
 * global + a matching CSRF cookie/header so readSessionUserId + verifyCsrf pass.
 */
function partRequest(
  sessionCookie: string,
  sessionId: string,
  part: number,
  bytes: Buffer,
  opts: { noCsrf?: boolean } = {}
): PutReq {
  const token = csrfToken()
  const cookie = opts.noCsrf ? sessionCookie : `${sessionCookie}; AAELINK_CSRF=${token}`
  ;(globalThis as { __TEST_COOKIE_HEADER__?: string }).__TEST_COOKIE_HEADER__ = cookie
  const headers = new Headers()
  headers.set('cookie', cookie)
  if (!opts.noCsrf) headers.set('x-csrf-token', token)
  const url = `http://localhost:3040/api/files/upload-sessions/${sessionId}?part=${part}`
  return new Request(url, {
    method: 'PUT',
    headers,
    body: new Uint8Array(bytes),
  }) as unknown as PutReq
}

async function createSession(
  user: TestUser,
  opts: { filename?: string; size: number; contentType?: string }
): Promise<{ id: string; part_size: number }> {
  const res = await SESSIONS_POST(asRequest('POST', '/api/files/upload-sessions', {
    cookie: user.sessionCookie,
    body: {
      filename: opts.filename || `r-${randomUUID().slice(0, 8)}.bin`,
      size: opts.size,
      content_type: opts.contentType || 'application/octet-stream',
    },
  }))
  const body = await expectSuccess<{ session: { id: string; part_size: number; parts_received: number[] } }>(res)
  sessionIds.push(body.session.id)
  expect(body.session.parts_received).toEqual([])
  return body.session
}

async function completeSession(user: TestUser, id: string) {
  return ACTION_POST(asRequest('POST', `/api/files/upload-sessions/${id}`, {
    cookie: user.sessionCookie,
    body: { action: 'complete' },
  }) as unknown as ActionReq, ctxFor(id))
}

beforeAll(async () => {
  ctx = await createTestContext()
  owner = await createTestUser(ctx.pool, { role: 'employee' })
  other = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(owner.id, other.id)
})

afterAll(async () => {
  if (fileIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.jobs WHERE payload LIKE ANY($1)`,
      [fileIds.map(id => `%${id}%`)])
    await ctx.pool.query(`DELETE FROM aaelink.file_scans WHERE file_id = ANY($1)`, [fileIds])
    await ctx.pool.query(`DELETE FROM aaelink.file_index WHERE file_id = ANY($1)`, [fileIds])
    await ctx.pool.query(`DELETE FROM aaelink.file_attachments WHERE id = ANY($1)`, [fileIds])
  }
  // Unlink on-disk artifacts for EVERY session we created, not just completed
  // ones. Error-path sessions (part_size_mismatch, parts_missing, forbidden,
  // csrf, invalid_part_number, etc.) leave their <id>.part partial behind; abort/
  // expired sweep already unlink theirs, but the rest would accumulate in the
  // committed working tree and mask real leaks. force:true ignores ENOENT.
  for (const id of sessionIds) {
    fs.rmSync(path.join(UPLOAD_DIR, 'partial', `${id}.part`), { force: true })
  }
  // Remove the renamed final objects for completed files (flat '<id><ext>' /
  // 'partial' already handled above). storage_key was selected per-file in the
  // assert; re-resolve from the row if it still exists, else best-effort by id.
  for (const fid of fileIds) {
    // Local final keys are '<file-id><ext>'; we don't track ext here, so glob the
    // dir for anything starting with the file id and unlink it.
    try {
      for (const name of fs.readdirSync(UPLOAD_DIR)) {
        if (name.startsWith(fid)) fs.rmSync(path.join(UPLOAD_DIR, name), { force: true })
      }
    } catch { /* dir absent — nothing staged */ }
  }
  if (sessionIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.upload_sessions WHERE id = ANY($1)`, [sessionIds])
  }
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('two-phase upload: create → out-of-order parts → resume → complete', () => {
  it('assembles a 3-part file uploaded out of order and persists it', async () => {
    // 2 full parts + a short final part.
    const finalLen = 1234
    const size = PART_SIZE * 2 + finalLen
    const part1 = Buffer.alloc(PART_SIZE, 1)
    const part2 = Buffer.alloc(PART_SIZE, 2)
    const part3 = Buffer.alloc(finalLen, 3)

    const session = await createSession(owner, { filename: 'big.bin', size })
    expect(session.part_size).toBe(PART_SIZE)

    // Upload OUT OF ORDER: 3, 1, 2.
    let r = await PART_PUT(partRequest(owner.sessionCookie, session.id, 3, part3), ctxFor(session.id))
    await expectSuccess(r)
    r = await PART_PUT(partRequest(owner.sessionCookie, session.id, 1, part1), ctxFor(session.id))
    await expectSuccess(r)

    // Resume status reflects the two received (sorted) parts before the last.
    const statusRes = await SESSIONS_GET(asRequest('GET', '/api/files/upload-sessions', {
      cookie: owner.sessionCookie,
      query: { session_id: session.id },
    }))
    const status = await expectSuccess<{
      status: string; received_bytes: number; parts_received: number[]; declared_size: number
    }>(statusRes)
    expect(status.status).toBe('active')
    expect(status.parts_received).toEqual([1, 3])
    expect(status.received_bytes).toBe(PART_SIZE + finalLen)
    expect(status.declared_size).toBe(size)

    r = await PART_PUT(partRequest(owner.sessionCookie, session.id, 2, part2), ctxFor(session.id))
    await expectSuccess(r)

    // Complete → canonical attachment.
    const completeRes = await completeSession(owner, session.id)
    const body = await expectSuccess<{ attachment: { id: string; size: number; storage_key: string } }>(completeRes)
    fileIds.push(body.attachment.id)
    expect(body.attachment.size).toBe(size)

    // file_attachments row exists with the right backend + size.
    const { rows } = await ctx.pool.query<{ storage_key: string; storage_backend: string; size: string }>(
      `SELECT storage_key, storage_backend, size::text FROM aaelink.file_attachments WHERE id = $1`,
      [body.attachment.id]
    )
    expect(rows[0].storage_backend).toBe('local')
    expect(Number(rows[0].size)).toBe(size)

    // Bytes on disk are the correctly-assembled file (right length + part ordering).
    const full = path.join(UPLOAD_DIR, rows[0].storage_key)
    expect(fs.existsSync(full)).toBe(true)
    const onDisk = fs.readFileSync(full)
    expect(onDisk.length).toBe(size)
    expect(onDisk[0]).toBe(1)                       // part 1 at offset 0
    expect(onDisk[PART_SIZE]).toBe(2)               // part 2 at offset PART_SIZE
    expect(onDisk[PART_SIZE * 2]).toBe(3)           // part 3 at offset 2*PART_SIZE

    // Pipeline jobs enqueued (file_scan + file_index) for the completed file.
    const { rows: jobs } = await ctx.pool.query<{ type: string }>(
      `SELECT type FROM aaelink.jobs WHERE payload LIKE $1`, [`%${body.attachment.id}%`]
    )
    const types = jobs.map(j => j.type)
    expect(types).toContain('file_scan')
    expect(types).toContain('file_index')

    // Session marked completed.
    const { rows: srows } = await ctx.pool.query<{ status: string }>(
      `SELECT status FROM aaelink.upload_sessions WHERE id = $1`, [session.id]
    )
    expect(srows[0].status).toBe('completed')
  })

  it('handles a single-part file', async () => {
    const size = 42
    const session = await createSession(owner, { filename: 'tiny.bin', size })
    const r = await PART_PUT(partRequest(owner.sessionCookie, session.id, 1, Buffer.alloc(size, 7)), ctxFor(session.id))
    await expectSuccess(r)
    const completeRes = await completeSession(owner, session.id)
    const body = await expectSuccess<{ attachment: { id: string; size: number } }>(completeRes)
    fileIds.push(body.attachment.id)
    expect(body.attachment.size).toBe(size)
  })
})

describe('validation + access control', () => {
  it('rejects a part with the wrong size (400 part_size_mismatch)', async () => {
    const size = PART_SIZE + 100
    const session = await createSession(owner, { filename: 'mm.bin', size })
    // Part 1 must be exactly PART_SIZE; send one byte short.
    const r = await PART_PUT(partRequest(owner.sessionCookie, session.id, 1, Buffer.alloc(PART_SIZE - 1, 1)), ctxFor(session.id))
    await expectError(r, 400, 'part_size_mismatch')
  })

  it('rejects an out-of-range part number (400 invalid_part_number)', async () => {
    const session = await createSession(owner, { filename: 'pn.bin', size: 100 })
    // Only part 1 exists for a sub-part-size file; part 2 is invalid.
    const r = await PART_PUT(partRequest(owner.sessionCookie, session.id, 2, Buffer.alloc(1)), ctxFor(session.id))
    await expectError(r, 400, 'invalid_part_number')
  })

  it('rejects a NaN / zero / negative part number (400)', async () => {
    const session = await createSession(owner, { filename: 'pn2.bin', size: 100 })
    for (const p of ['abc', '0', '-1']) {
      const token = csrfToken()
      const cookie = `${owner.sessionCookie}; AAELINK_CSRF=${token}`
      ;(globalThis as { __TEST_COOKIE_HEADER__?: string }).__TEST_COOKIE_HEADER__ = cookie
      const headers = new Headers()
      headers.set('cookie', cookie)
      headers.set('x-csrf-token', token)
      const req = new Request(
        `http://localhost:3040/api/files/upload-sessions/${session.id}?part=${p}`,
        { method: 'PUT', headers, body: new Uint8Array(Buffer.alloc(1)) }
      ) as unknown as PutReq
      const r = await PART_PUT(req, ctxFor(session.id))
      expect(r.status).toBe(400)
    }
  })

  it('treats a re-sent part as an idempotent no-op (duplicate=true)', async () => {
    const size = 50
    const session = await createSession(owner, { filename: 'dup.bin', size })
    const r1 = await PART_PUT(partRequest(owner.sessionCookie, session.id, 1, Buffer.alloc(size, 9)), ctxFor(session.id))
    const b1 = await expectSuccess<{ duplicate: boolean; parts_received: number[] }>(r1)
    expect(b1.duplicate).toBe(false)
    const r2 = await PART_PUT(partRequest(owner.sessionCookie, session.id, 1, Buffer.alloc(size, 9)), ctxFor(session.id))
    const b2 = await expectSuccess<{ duplicate: boolean; parts_received: number[] }>(r2)
    expect(b2.duplicate).toBe(true)
    expect(b2.parts_received).toEqual([1])
  })

  it('forbids a non-owner from appending (403)', async () => {
    const session = await createSession(owner, { filename: 'own.bin', size: 100 })
    const r = await PART_PUT(partRequest(other.sessionCookie, session.id, 1, Buffer.alloc(100, 1)), ctxFor(session.id))
    await expectError(r, 403, 'forbidden')
  })

  it('forbids a non-owner from reading status (403)', async () => {
    const session = await createSession(owner, { filename: 'st.bin', size: 100 })
    const res = await SESSIONS_GET(asRequest('GET', '/api/files/upload-sessions', {
      cookie: other.sessionCookie,
      query: { session_id: session.id },
    }))
    await expectError(res, 403, 'forbidden')
  })

  it('requires CSRF on PUT (noAutoCsrf → csrf error)', async () => {
    const session = await createSession(owner, { filename: 'csrf.bin', size: 100 })
    const r = await PART_PUT(
      partRequest(owner.sessionCookie, session.id, 1, Buffer.alloc(100, 1), { noCsrf: true }),
      ctxFor(session.id)
    )
    expect(r.status).toBe(403)
    const body = await r.json() as { error: string }
    expect(body.error.startsWith('csrf')).toBe(true)
  })

  it('requires CSRF on create (noAutoCsrf → csrf error)', async () => {
    const res = await SESSIONS_POST(asRequest('POST', '/api/files/upload-sessions', {
      cookie: owner.sessionCookie,
      body: { filename: 'x.bin', size: 100 },
      noAutoCsrf: true,
    }))
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error.startsWith('csrf')).toBe(true)
  })

  it('rejects a declared size over the 5 GB ceiling (413)', async () => {
    const res = await SESSIONS_POST(asRequest('POST', '/api/files/upload-sessions', {
      cookie: owner.sessionCookie,
      body: { filename: 'huge.bin', size: 5 * 1024 * 1024 * 1024 + 1 },
    }))
    await expectError(res, 413, 'file_too_large')
  })
})

describe('complete + abort lifecycle', () => {
  it('409s completing with missing parts and lists them', async () => {
    const size = PART_SIZE + 10
    const session = await createSession(owner, { filename: 'incomplete.bin', size })
    // Only part 1 of 2.
    await expectSuccess(await PART_PUT(partRequest(owner.sessionCookie, session.id, 1, Buffer.alloc(PART_SIZE, 1)), ctxFor(session.id)))
    const res = await completeSession(owner, session.id)
    const body = await expectError(res, 409, 'parts_missing')
    expect(body.missing).toEqual([2])
  })

  it('double-complete returns 200 idempotently (same attachment)', async () => {
    const size = 30
    const session = await createSession(owner, { filename: 'twice.bin', size })
    await expectSuccess(await PART_PUT(partRequest(owner.sessionCookie, session.id, 1, Buffer.alloc(size, 5)), ctxFor(session.id)))
    const first = await completeSession(owner, session.id)
    const fb = await expectSuccess<{ attachment: { id: string } }>(first)
    fileIds.push(fb.attachment.id)
    const second = await completeSession(owner, session.id)
    const sb = await expectSuccess<{ attachment: { id: string } }>(second)
    expect(sb.attachment.id).toBe(fb.attachment.id)
  })

  it('abort unlinks the local partial file and marks the session aborted', async () => {
    const size = PART_SIZE + 10
    const session = await createSession(owner, { filename: 'aborted.bin', size })
    await expectSuccess(await PART_PUT(partRequest(owner.sessionCookie, session.id, 1, Buffer.alloc(PART_SIZE, 1)), ctxFor(session.id)))
    const partial = path.join(UPLOAD_DIR, 'partial', `${session.id}.part`)
    expect(fs.existsSync(partial)).toBe(true)

    const res = await ACTION_POST(asRequest('POST', `/api/files/upload-sessions/${session.id}`, {
      cookie: owner.sessionCookie,
      body: { action: 'abort' },
    }) as unknown as ActionReq, ctxFor(session.id))
    await expectSuccess(res)

    expect(fs.existsSync(partial)).toBe(false)
    const { rows } = await ctx.pool.query<{ status: string }>(
      `SELECT status FROM aaelink.upload_sessions WHERE id = $1`, [session.id]
    )
    expect(rows[0].status).toBe('aborted')
  })

  it('rejects an unknown action (400 invalid_action)', async () => {
    const session = await createSession(owner, { filename: 'badaction.bin', size: 10 })
    const res = await ACTION_POST(asRequest('POST', `/api/files/upload-sessions/${session.id}`, {
      cookie: owner.sessionCookie,
      body: { action: 'frobnicate' },
    }) as unknown as ActionReq, ctxFor(session.id))
    await expectError(res, 400, 'invalid_action')
  })
})

describe('concurrency + races', () => {
  /**
   * Build a part PUT that shares ONE pre-agreed CSRF token + cookie, so a batch
   * of these can be dispatched via Promise.all: the test harness mocks cookies()
   * from a single process-global header, so every parallel request must carry the
   * SAME token (the per-call token in partRequest() would clobber the global and
   * make in-flight siblings 403). Set the global cookie ONCE before dispatching.
   */
  function sharedPartRequest(sessionCookie: string, token: string, sessionId: string, part: number, bytes: Buffer): PutReq {
    const headers = new Headers()
    headers.set('cookie', `${sessionCookie}; AAELINK_CSRF=${token}`)
    headers.set('x-csrf-token', token)
    const url = `http://localhost:3040/api/files/upload-sessions/${sessionId}?part=${part}`
    return new Request(url, { method: 'PUT', headers, body: new Uint8Array(bytes) }) as unknown as PutReq
  }

  it('two distinct parts appended in parallel BOTH land (version-guarded, no lost part)', async () => {
    // The bug the version token fixes: two appends reading the same base row
    // within the same millisecond could both match a wall-clock updated_at guard
    // and the loser would overwrite the winner's parts_received, dropping a part.
    const size = PART_SIZE + 100
    const session = await createSession(owner, { filename: 'parallel.bin', size })
    const part1 = Buffer.alloc(PART_SIZE, 1)
    const part2 = Buffer.alloc(100, 2)

    // One shared token for both parallel requests + set the global cookie once.
    const token = csrfToken()
    ;(globalThis as { __TEST_COOKIE_HEADER__?: string }).__TEST_COOKIE_HEADER__ =
      `${owner.sessionCookie}; AAELINK_CSRF=${token}`

    const [r1, r2] = await Promise.all([
      PART_PUT(sharedPartRequest(owner.sessionCookie, token, session.id, 1, part1), ctxFor(session.id)),
      PART_PUT(sharedPartRequest(owner.sessionCookie, token, session.id, 2, part2), ctxFor(session.id)),
    ])
    // Both succeed (the version-guard retry loop serializes them); neither part
    // is dropped — exactly what the optimistic-concurrency fix guarantees.
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)

    const sess = await getUploadSession(ctx.pool, session.id)
    expect(sess!.parts_received.slice().sort((a, b) => a - b)).toEqual([1, 2])
    expect(Number(sess!.received_bytes)).toBe(size)

    // And it completes cleanly with both parts present.
    const completeRes = await completeSession(owner, session.id)
    const body = await expectSuccess<{ attachment: { id: string; size: number } }>(completeRes)
    fileIds.push(body.attachment.id)
    expect(body.attachment.size).toBe(size)
  })

  it('two completes racing the same finished session both resolve idempotently (no unmapped 500)', async () => {
    const size = PART_SIZE + 50
    const session = await createSession(owner, { filename: 'race.bin', size })
    // Fully populate the session first so both completes have all parts.
    await expectSuccess(await PART_PUT(partRequest(owner.sessionCookie, session.id, 1, Buffer.alloc(PART_SIZE, 1)), ctxFor(session.id)))
    await expectSuccess(await PART_PUT(partRequest(owner.sessionCookie, session.id, 2, Buffer.alloc(50, 2)), ctxFor(session.id)))

    // Build BOTH completes with ONE shared CSRF token + set the global cookie
    // once (the mocked cookies() reads a single process-global, so parallel
    // requests must agree on the token). The claim-first ordering then means
    // exactly one wins the active→completed flip and the loser returns the SAME
    // attachment — never an unmapped 500 from a CompleteMultipartUpload against an
    // aborted upload.
    const token = csrfToken()
    ;(globalThis as { __TEST_COOKIE_HEADER__?: string }).__TEST_COOKIE_HEADER__ =
      `${owner.sessionCookie}; AAELINK_CSRF=${token}`
    const buildComplete = () => {
      const headers = new Headers()
      headers.set('cookie', `${owner.sessionCookie}; AAELINK_CSRF=${token}`)
      headers.set('x-csrf-token', token)
      headers.set('content-type', 'application/json')
      const req = new Request(`http://localhost:3040/api/files/upload-sessions/${session.id}`, {
        method: 'POST', headers, body: JSON.stringify({ action: 'complete' }),
      }) as unknown as ActionReq
      return ACTION_POST(req, ctxFor(session.id))
    }
    const [c1, c2] = await Promise.allSettled([buildComplete(), buildComplete()])
    expect(c1.status).toBe('fulfilled')
    expect(c2.status).toBe('fulfilled')
    if (c1.status !== 'fulfilled' || c2.status !== 'fulfilled') throw new Error('unreachable')
    const b1 = await expectSuccess<{ attachment: { id: string } }>(c1.value)
    const b2 = await expectSuccess<{ attachment: { id: string } }>(c2.value)
    expect(b1.attachment.id).toBe(b2.attachment.id)
    fileIds.push(b1.attachment.id)
    const sess = await getUploadSession(ctx.pool, session.id)
    expect(sess!.status).toBe('completed')
  })

  it('a complete that wins the claim makes a racing append lose its guard (engine-level)', async () => {
    // Engine-level (not via the global-cookie route harness) so we can interleave
    // deterministically: complete claims active→completed, then a later append on
    // the same session must surface session_not_active (409), never silently
    // mutate the completed row.
    const size = PART_SIZE + 60
    const session = await createSession(owner, { filename: 'cva.bin', size })
    await expectSuccess(await PART_PUT(partRequest(owner.sessionCookie, session.id, 1, Buffer.alloc(PART_SIZE, 1)), ctxFor(session.id)))
    await expectSuccess(await PART_PUT(partRequest(owner.sessionCookie, session.id, 2, Buffer.alloc(60, 2)), ctxFor(session.id)))

    const completeRes = await completeUploadSession(ctx.pool, { sessionId: session.id, uid: owner.id })
    fileIds.push(completeRes.attachment.id)

    // A late append (e.g. a duplicate-retry of part 1) hits the status guard.
    await expect(
      appendPart(ctx.pool, { sessionId: session.id, partNumber: 1, bytes: Buffer.alloc(PART_SIZE, 1), uid: owner.id })
    ).rejects.toMatchObject({ code: 'session_not_active', status: 409 })
  })

  it('a re-sent part with DIFFERENT bytes is discarded (duplicate=true, original bytes kept)', async () => {
    // Documented behavior: a re-sent part number is an idempotent no-op; the NEW
    // bytes are NOT re-written. We assert the discard is intentional so a client
    // bug (resending different content for the same part) cannot silently corrupt.
    const size = 40
    const session = await createSession(owner, { filename: 'diffbytes.bin', size })
    const first = await PART_PUT(partRequest(owner.sessionCookie, session.id, 1, Buffer.alloc(size, 0xaa)), ctxFor(session.id))
    const fb = await expectSuccess<{ duplicate: boolean }>(first)
    expect(fb.duplicate).toBe(false)
    // Re-send part 1 with different bytes → duplicate=true, discarded.
    const second = await PART_PUT(partRequest(owner.sessionCookie, session.id, 1, Buffer.alloc(size, 0xbb)), ctxFor(session.id))
    const sb = await expectSuccess<{ duplicate: boolean }>(second)
    expect(sb.duplicate).toBe(true)

    const completeRes = await completeSession(owner, session.id)
    const body = await expectSuccess<{ attachment: { id: string; storage_key: string } }>(completeRes)
    fileIds.push(body.attachment.id)
    // The ORIGINAL bytes (0xaa) are on disk, not the discarded 0xbb resend.
    const full = path.join(UPLOAD_DIR, body.attachment.storage_key)
    const onDisk = fs.readFileSync(full)
    expect(onDisk[0]).toBe(0xaa)
    expect(onDisk[size - 1]).toBe(0xaa)
  })
})

describe('engine backstops (direct, route-unreachable)', () => {
  it('size_exceeded aborts the session and throws 413 when received+part overruns declared', async () => {
    // The append-time cumulative ceiling (size_exceeded → abort → 413) is a hard
    // backstop the route can't reach (exact part-size + range guard keep
    // received_bytes <= declared for accepted parts). Drive it at the engine
    // level: poison received_bytes to declared, then append a valid part so
    // received_bytes + part.length > declared.
    const size = PART_SIZE + 20
    const session = await createSession(owner, { filename: 'overrun.bin', size })
    // Land part 1 normally.
    await expectSuccess(await PART_PUT(partRequest(owner.sessionCookie, session.id, 1, Buffer.alloc(PART_SIZE, 1)), ctxFor(session.id)))
    // Poison received_bytes up to the declared size (simulating a corrupted
    // accounting state) WITHOUT recording part 2, leaving it appendable.
    await ctx.pool.query(
      `UPDATE aaelink.upload_sessions SET received_bytes = $1 WHERE id = $2`,
      [size, session.id]
    )
    // Appending the valid 20-byte final part now overruns declared → abort + 413.
    await expect(
      appendPart(ctx.pool, { sessionId: session.id, partNumber: 2, bytes: Buffer.alloc(20, 2), uid: owner.id })
    ).rejects.toMatchObject({ code: 'size_exceeded', status: 413 })

    // The backstop aborted the session and cleaned its partial.
    const sess = await getUploadSession(ctx.pool, session.id)
    expect(sess!.status).toBe('aborted')
    const partial = path.join(UPLOAD_DIR, 'partial', `${session.id}.part`)
    expect(fs.existsSync(partial)).toBe(false)
  })
})

describe('per-user concurrent-session cap', () => {
  it('rejects the (max+1)th active session with 429 too_many_active_sessions', async () => {
    // Open MAX active sessions for a dedicated user, then assert the next create
    // is rejected before allocating storage.
    const capUser = await createTestUser(ctx.pool, { role: 'employee' })
    userIds.push(capUser.id)
    for (let i = 0; i < MAX_ACTIVE_SESSIONS_PER_USER; i++) {
      const res = await SESSIONS_POST(asRequest('POST', '/api/files/upload-sessions', {
        cookie: capUser.sessionCookie,
        body: { filename: `cap-${i}.bin`, size: 100 },
      }))
      const body = await expectSuccess<{ session: { id: string } }>(res)
      sessionIds.push(body.session.id)
    }
    const overflow = await SESSIONS_POST(asRequest('POST', '/api/files/upload-sessions', {
      cookie: capUser.sessionCookie,
      body: { filename: 'cap-overflow.bin', size: 100 },
    }))
    const body = await expectError(overflow, 429, 'too_many_active_sessions')
    expect(body.max_active).toBe(MAX_ACTIVE_SESSIONS_PER_USER)
  })
})

describe('expired sweep', () => {
  it('marks an expired active session and unlinks its partial', async () => {
    const size = PART_SIZE + 10
    const session = await createSession(owner, { filename: 'stale.bin', size })
    await expectSuccess(await PART_PUT(partRequest(owner.sessionCookie, session.id, 1, Buffer.alloc(PART_SIZE, 1)), ctxFor(session.id)))
    const partial = path.join(UPLOAD_DIR, 'partial', `${session.id}.part`)
    expect(fs.existsSync(partial)).toBe(true)

    // Force the session's TTL into the past.
    await ctx.pool.query(
      `UPDATE aaelink.upload_sessions SET expires_at = $1 WHERE id = $2`,
      [Date.now() - 1000, session.id]
    )

    const expired = await sweepExpiredUploadSessions(ctx.pool, Date.now())
    expect(expired).toBeGreaterThanOrEqual(1)

    const { rows } = await ctx.pool.query<{ status: string }>(
      `SELECT status FROM aaelink.upload_sessions WHERE id = $1`, [session.id]
    )
    expect(rows[0].status).toBe('expired')
    expect(fs.existsSync(partial)).toBe(false)
  })
})
