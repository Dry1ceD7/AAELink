/**
 * Integration tests for the reconciled file-scan policy surface.
 *
 * One source of truth (lib/files/scanGate ScanPolicy) is now read/written by
 * BOTH the admin route (POST /api/files/scan?update_policy) and enforced at
 * upload (POST /api/files/upload). These exercise:
 *   - POST /api/files/scan update_policy: RBAC (employee 403), CSRF (missing →
 *     403), audit row written, and that the persisted policy is the enforced
 *     shape (block_infected pinned, extensions normalized).
 *   - POST /api/files/upload: policy size cap REPLACES the 50MB default when set
 *     (413 file_too_large) and a blocked extension is rejected (415).
 *
 * Run against a live Postgres. afterAll restores DEFAULT_SCAN_POLICY so this
 * suite never leaks a cap / blocked extension into other file suites.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID, createHmac } from 'crypto'
import {
  createTestContext,
  createTestUser,
  createTestChannel,
  asRequest,
  expectError,
  expectSuccess,
  TestContext,
  TestUser,
  TestChannel,
} from '../helpers'
import { setScanPolicy, getScanPolicy, DEFAULT_SCAN_POLICY } from '@/lib/files/scanGate'

import { GET as SCAN_GET, POST as SCAN_POST } from '@/app/api/files/scan/route'
import { POST as UPLOAD_POST } from '@/app/api/files/upload/route'

let ctx: TestContext
let admin: TestUser
let itAdmin: TestUser
let member: TestUser
let channel: TestChannel
const userIds: string[] = []
const fileIds: string[] = []

/** Mint a CSRF token matching lib/auth/csrf (test secret). */
function csrfToken(): string {
  const secret = process.env.CSRF_SECRET || 'test-csrf-secret'
  const raw = randomUUID().replace(/-/g, '')
  const sig = createHmac('sha256', secret).update(raw).digest('hex').slice(0, 16)
  return `${raw}.${sig}`
}

type NextRequestLike = Parameters<typeof UPLOAD_POST>[0]

/** Build a multipart upload request (route reads req.formData → not asRequest). */
function uploadRequest(
  sessionCookie: string,
  opts: { filename: string; type: string; bytes: Buffer; channelId?: string }
): NextRequestLike {
  const fd = new FormData()
  const blob = new Blob([opts.bytes], { type: opts.type })
  fd.set('file', blob, opts.filename)
  if (opts.channelId) fd.set('channel_id', opts.channelId)

  const token = csrfToken()
  const cookie = `${sessionCookie}; AAELINK_CSRF=${token}`
  ;(globalThis as { __TEST_COOKIE_HEADER__?: string }).__TEST_COOKIE_HEADER__ = cookie

  const headers = new Headers()
  headers.set('cookie', cookie)
  headers.set('x-csrf-token', token)
  return new Request('http://localhost:3040/api/files/upload', {
    method: 'POST',
    headers,
    body: fd,
  }) as unknown as NextRequestLike
}

/**
 * Poll for an audit row. writeAuditLog is fire-and-forget (not awaited by the
 * handler), so the INSERT may land a tick after the HTTP response.
 */
async function waitForAudit(action: string, resourceId: string): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    const { rows } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.audit_log WHERE action = $1 AND resource_id = $2`, [action, resourceId]
    )
    if (rows.length > 0) return true
    await new Promise((r) => setTimeout(r, 25))
  }
  return false
}

beforeAll(async () => {
  ctx = await createTestContext()
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  itAdmin = await createTestUser(ctx.pool, { role: 'it_admin' })
  member = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(admin.id, itAdmin.id, member.id)
  channel = await createTestChannel(ctx.pool, admin.id)
})

afterAll(async () => {
  // Restore defaults FIRST so later file suites (files.test.ts asserts scan
  // jobs enqueue; runs after this one alphabetically) never see a cap /
  // blocked extensions / scan_on_upload=false — even if a later cleanup
  // statement throws, the shared global policy is already clean.
  await setScanPolicy(ctx.pool, { ...DEFAULT_SCAN_POLICY })
  if (fileIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.jobs WHERE payload LIKE ANY($1)`,
      [fileIds.map(id => `%${id}%`)])
    await ctx.pool.query(`DELETE FROM aaelink.file_scans WHERE file_id = ANY($1)`, [fileIds])
    await ctx.pool.query(`DELETE FROM aaelink.file_index WHERE file_id = ANY($1)`, [fileIds])
    await ctx.pool.query(`DELETE FROM aaelink.file_attachments WHERE id = ANY($1)`, [fileIds])
  }
  await ctx.pool.query(`DELETE FROM aaelink.audit_log WHERE actor_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = $1`, [channel.id])
  await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('POST /api/files/scan update_policy — RBAC + CSRF + audit', () => {
  it('rejects a non-admin (employee → 403)', async () => {
    const res = await SCAN_POST(asRequest('POST', '/api/files/scan', {
      cookie: member.sessionCookie,
      body: { action: 'update_policy', policy: { block_unscanned: true } },
    }))
    await expectError(res, 403, 'forbidden')
  })

  it('rejects an admin without a CSRF token (403)', async () => {
    const res = await SCAN_POST(asRequest('POST', '/api/files/scan', {
      cookie: admin.sessionCookie,
      body: { action: 'update_policy', policy: { block_unscanned: true } },
      noAutoCsrf: true,
    }))
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error.startsWith('csrf')).toBe(true)
  })

  it('persists the enforced shape, pins block_infected, normalizes extensions, and audits', async () => {
    const res = await SCAN_POST(asRequest('POST', '/api/files/scan', {
      cookie: admin.sessionCookie,
      body: {
        action: 'update_policy',
        policy: {
          block_infected: false, // ignored — pinned true
          block_unscanned: true,
          max_file_size_mb: 10,
          blocked_extensions: ['.EXE', 'bat', '.exe'],
          enabled: false, // decorative legacy key — ignored
        },
      },
    }))
    const body = await expectSuccess<{ policy: {
      block_infected: boolean; block_unscanned: boolean; max_file_size_mb: number
      blocked_extensions: string[]
    } }>(res)
    expect(body.policy.block_infected).toBe(true)
    expect(body.policy.block_unscanned).toBe(true)
    expect(body.policy.max_file_size_mb).toBe(10)
    expect(body.policy.blocked_extensions).toEqual(['.exe', '.bat'])
    expect((body.policy as Record<string, unknown>).enabled).toBeUndefined()

    // Persisted via the single source of truth.
    const stored = await getScanPolicy(ctx.pool)
    expect(stored.block_unscanned).toBe(true)
    expect(stored.max_file_size_mb).toBe(10)
    expect(stored.blocked_extensions).toEqual(['.exe', '.bat'])

    expect(await waitForAudit('file.scan_policy.update', 'file_scan_policy')).toBe(true)
  })

  it('GET returns the same enforced shape an admin just wrote', async () => {
    await setScanPolicy(ctx.pool, { block_unscanned: true, max_file_size_mb: 7 })
    const res = await SCAN_GET(asRequest('GET', '/api/files/scan', { cookie: admin.sessionCookie }))
    const body = await expectSuccess<{ policy: {
      block_infected: boolean; block_unscanned: boolean; max_file_size_mb: number
    } }>(res)
    expect(body.policy.block_infected).toBe(true)
    expect(body.policy.block_unscanned).toBe(true)
    expect(body.policy.max_file_size_mb).toBe(7)
  })
})

describe('GET /api/files/scan — RBAC (super_admin-only → isPlatformAdmin broadening)', () => {
  it('denies a non-admin employee (403 forbidden)', async () => {
    const res = await SCAN_GET(asRequest('GET', '/api/files/scan', { cookie: member.sessionCookie }))
    await expectError(res, 403, 'forbidden')
  })

  it('now allows an it_admin (isPlatformAdmin grants it_admin → 200)', async () => {
    const res = await SCAN_GET(asRequest('GET', '/api/files/scan', { cookie: itAdmin.sessionCookie }))
    const body = await expectSuccess<{ policy: { block_infected: boolean }; summary: unknown; scans: unknown }>(res)
    // The broadened gate returns the org-wide scan surface (policy/summary/scans).
    expect(body.policy.block_infected).toBe(true)
  })
})

describe('POST /api/files/scan scan_file — CSRF + happy path', () => {
  it('rejects an admin without a CSRF token (403 csrf*)', async () => {
    const fileId = randomUUID()
    const res = await SCAN_POST(asRequest('POST', '/api/files/scan', {
      cookie: admin.sessionCookie,
      body: { action: 'scan_file', file_id: fileId },
      noAutoCsrf: true,
    }))
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error.startsWith('csrf')).toBe(true)
  })

  it('submits a file for scanning (201) and enqueues a pending file_scans row + file_scan job', async () => {
    const fileId = randomUUID()
    fileIds.push(fileId) // afterAll cleans file_scans + jobs by this file_id
    const res = await SCAN_POST(asRequest('POST', '/api/files/scan', {
      cookie: admin.sessionCookie,
      body: { action: 'scan_file', file_id: fileId, filename: 'doc.pdf', mime_type: 'application/pdf' },
    }))
    expect(res.status).toBe(201)
    const body = await res.json() as { scan: { id: string; file_id: string; result: string } }
    expect(body.scan.file_id).toBe(fileId)
    expect(body.scan.result).toBe('pending')

    // Pending scan row recorded for the D12 gate / scan worker.
    const { rows: scans } = await ctx.pool.query<{ id: string; result: string }>(
      `SELECT id, result FROM aaelink.file_scans WHERE file_id = $1`, [fileId]
    )
    expect(scans.length).toBe(1)
    expect(scans[0].result).toBe('pending')
    expect(scans[0].id).toBe(body.scan.id)

    // file_scan job enqueued carrying the matching scan_id.
    const { rows: jobs } = await ctx.pool.query<{ type: string; payload: string }>(
      `SELECT type, payload FROM aaelink.jobs WHERE payload LIKE $1`, [`%${fileId}%`]
    )
    const scanJob = jobs.find(j => j.type === 'file_scan')
    expect(scanJob).toBeDefined()
    expect(scanJob!.payload).toContain(body.scan.id)
  })
})

describe('POST /api/files/upload — policy enforcement', () => {
  it('413s when the file exceeds the policy size cap (cap replaces the 50MB default)', async () => {
    // 1 MB cap; upload 2 MB.
    await setScanPolicy(ctx.pool, { ...DEFAULT_SCAN_POLICY, max_file_size_mb: 1 })
    const res = await UPLOAD_POST(uploadRequest(admin.sessionCookie, {
      filename: 'big.bin', type: 'application/octet-stream',
      bytes: Buffer.alloc(2 * 1024 * 1024, 1),
      channelId: channel.id,
    }))
    const body = await expectError(res, 413, 'file_too_large')
    expect(body.max).toBe(1 * 1024 * 1024)
  })

  it('415s when the extension is blocked', async () => {
    await setScanPolicy(ctx.pool, { ...DEFAULT_SCAN_POLICY, blocked_extensions: ['.exe'] })
    const res = await UPLOAD_POST(uploadRequest(admin.sessionCookie, {
      filename: 'tool.EXE', type: 'application/octet-stream',
      bytes: Buffer.from('MZ'),
      channelId: channel.id,
    }))
    await expectError(res, 415, 'extension_blocked')
  })

  it('415s for extname() bypass forms that normalize back to a blocked extension', async () => {
    await setScanPolicy(ctx.pool, { ...DEFAULT_SCAN_POLICY, blocked_extensions: ['.exe'] })
    // Each of these would slip past a naive `extname === '.exe'` check, but the
    // OS/client normalizes the saved name back to a dangerous '.exe'.
    const NUL = String.fromCharCode(0)
    const bypassNames = [
      'evil.exe.',                  // trailing dot — extname() returns '.' ; stripped on save
      'evil.exe ',                  // trailing space — extname() returns '.exe ' ; stripped on Windows
      `evil.exe${NUL}.txt`,         // NUL injection — extname() returns '.txt' ; truncated at NUL
      'report.exe.pdf',             // double-extension — final extname is '.pdf', inner segment is '.exe'
    ]
    for (const filename of bypassNames) {
      const res = await UPLOAD_POST(uploadRequest(admin.sessionCookie, {
        filename, type: 'application/octet-stream',
        bytes: Buffer.from('MZ'),
        channelId: channel.id,
      }))
      const body = await expectError(res, 415, 'extension_blocked')
      expect(body.extension).toBe('.exe')
    }
  })

  it('accepts a normal file under the default policy (no cap, no blocks)', async () => {
    await setScanPolicy(ctx.pool, { ...DEFAULT_SCAN_POLICY })
    const res = await UPLOAD_POST(uploadRequest(admin.sessionCookie, {
      filename: 'ok.txt', type: 'text/plain',
      bytes: Buffer.from('hello'),
      channelId: channel.id,
    }))
    const body = await expectSuccess<{ attachment: { id: string } }>(res)
    fileIds.push(body.attachment.id)
    expect(body.attachment.id).toBeTruthy()
  })

  it('does not enqueue a file_scan job when scan_on_upload is off', async () => {
    await setScanPolicy(ctx.pool, { ...DEFAULT_SCAN_POLICY, scan_on_upload: false })
    const res = await UPLOAD_POST(uploadRequest(admin.sessionCookie, {
      filename: 'noscan.txt', type: 'text/plain',
      bytes: Buffer.from('hello'),
      channelId: channel.id,
    }))
    const body = await expectSuccess<{ attachment: { id: string } }>(res)
    fileIds.push(body.attachment.id)

    const { rows: jobs } = await ctx.pool.query<{ type: string }>(
      `SELECT type FROM aaelink.jobs WHERE payload LIKE $1`, [`%${body.attachment.id}%`]
    )
    const types = jobs.map(j => j.type)
    expect(types).not.toContain('file_scan')
    // Index still happens.
    expect(types).toContain('file_index')
    // No pending scan row was created.
    const { rows: scans } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.file_scans WHERE file_id = $1`, [body.attachment.id]
    )
    expect(scans.length).toBe(0)

    await setScanPolicy(ctx.pool, { ...DEFAULT_SCAN_POLICY })
  })
})
