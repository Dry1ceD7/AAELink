/**
 * Integration tests for the canonical file_attachments subsystem (Stage A).
 *
 * Migration 033 made aaelink.file_attachments the single canonical file row and
 * the routes below were repointed onto it from phantom tables (aaelink.files,
 * aaelink.file_uploads):
 *   - POST /api/files/upload    — always persists a row (even unattached)
 *   - GET  /api/files           — list + ?file_id= info
 *   - DELETE /api/files         — soft delete (CSRF + audit)
 *   - GET  /api/files/preview   — metadata for a real upload
 *
 * These exercise the routes against a live Postgres so the table repointing is
 * verified end to end.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID, createHmac } from 'crypto'
import fs from 'fs'
import path from 'path'
import {
  createTestContext,
  createTestUser,
  createTestChannel,
  asRequest,
  expectSuccess,
  expectError,
  TestContext,
  TestUser,
  TestChannel,
} from '../helpers'

import { POST as UPLOAD_POST } from '@/app/api/files/upload/route'
import { GET as FILES_GET, DELETE as FILES_DELETE } from '@/app/api/files/route'
import { GET as PREVIEW_GET } from '@/app/api/files/preview/route'
import { GET as DOWNLOAD_GET } from '@/app/api/files/[id]/download/route'

let ctx: TestContext
let owner: TestUser
let other: TestUser
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

/**
 * Build a multipart upload request. The upload route reads req.formData(), so we
 * cannot go through asRequest (which JSON-encodes the body). We set the test
 * cookie global directly (same mechanism asRequest uses) so readSessionUserId
 * authenticates. tracedRoute CSRF-gates every mutation, so we attach a matching
 * CSRF cookie + header (mirroring asRequest's auto-CSRF for JSON requests).
 */
function uploadRequest(
  sessionCookie: string,
  opts: { filename: string; type: string; bytes: Buffer; channelId?: string; messageId?: string }
): NextRequestLike {
  const fd = new FormData()
  const blob = new Blob([opts.bytes], { type: opts.type })
  fd.set('file', blob, opts.filename)
  if (opts.channelId) fd.set('channel_id', opts.channelId)
  if (opts.messageId) fd.set('message_id', opts.messageId)

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

// The route handlers are typed for NextRequest; a Request is structurally
// sufficient for the fields they touch (formData, headers, cookies via global).
type NextRequestLike = Parameters<typeof UPLOAD_POST>[0]

async function doUpload(
  user: TestUser,
  opts: { filename?: string; type?: string; channelId?: string; messageId?: string } = {}
): Promise<{ id: string; filename: string }> {
  const req = uploadRequest(user.sessionCookie, {
    filename: opts.filename || `f-${randomUUID().slice(0, 8)}.txt`,
    type: opts.type || 'text/plain',
    bytes: Buffer.from('hello world'),
    channelId: opts.channelId,
    messageId: opts.messageId,
  })
  const res = await UPLOAD_POST(req)
  const body = await expectSuccess<{ attachment: { id: string; filename: string } }>(res)
  fileIds.push(body.attachment.id)
  return body.attachment
}

beforeAll(async () => {
  ctx = await createTestContext()
  owner = await createTestUser(ctx.pool, { role: 'employee' })
  other = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(owner.id, other.id)
  channel = await createTestChannel(ctx.pool, owner.id)
})

const UPLOAD_DIR = process.env.AAELINK_UPLOAD_DIR || path.join(process.cwd(), '.uploads')

afterAll(async () => {
  if (fileIds.length) {
    // Pipeline rows the upload now enqueues, cleaned up first (jobs/scan/index).
    await ctx.pool.query(`DELETE FROM aaelink.jobs WHERE payload LIKE ANY($1)`,
      [fileIds.map(id => `%${id}%`)])
    await ctx.pool.query(`DELETE FROM aaelink.file_scans WHERE file_id = ANY($1)`, [fileIds])
    await ctx.pool.query(`DELETE FROM aaelink.file_index WHERE file_id = ANY($1)`, [fileIds])
    await ctx.pool.query(`DELETE FROM aaelink.file_attachments WHERE id = ANY($1)`, [fileIds])
  }
  await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = $1`, [channel.id])
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('POST /api/files/upload', () => {
  it('persists a row that GET /api/files then lists', async () => {
    const up = await doUpload(owner, { channelId: channel.id, filename: 'listed.txt' })

    const res = await FILES_GET(asRequest('GET', '/api/files', {
      cookie: owner.sessionCookie,
      query: { channel_id: channel.id },
    }))
    const body = await expectSuccess<{ files: Array<{ id: string; name: string }> }>(res)
    expect(body.files.some(f => f.id === up.id && f.name === 'listed.txt')).toBe(true)
  })

  it('persists an unattached upload (no message_id, no channel_id)', async () => {
    const up = await doUpload(owner)
    const { rows } = await ctx.pool.query<{ id: string; message_id: string | null; channel_id: string | null }>(
      `SELECT id, message_id, channel_id FROM aaelink.file_attachments WHERE id = $1`, [up.id]
    )
    expect(rows[0]).toBeTruthy()
    expect(rows[0].message_id).toBeNull()
    expect(rows[0].channel_id).toBeNull()
  })
})

describe('GET /api/files?file_id=', () => {
  it('returns info for a real upload', async () => {
    const up = await doUpload(owner, { channelId: channel.id, filename: 'info.txt' })
    const res = await FILES_GET(asRequest('GET', '/api/files', {
      cookie: owner.sessionCookie,
      query: { file_id: up.id },
    }))
    const body = await expectSuccess<{ file: { id: string; name: string; user: string } }>(res)
    expect(body.file.id).toBe(up.id)
    expect(body.file.name).toBe('info.txt')
    expect(body.file.user).toBe(owner.id)
  })

  it('404s for an unknown file', async () => {
    const res = await FILES_GET(asRequest('GET', '/api/files', {
      cookie: owner.sessionCookie,
      query: { file_id: 'does-not-exist' },
    }))
    await expectError(res, 404, 'file_not_found')
  })
})

describe('GET /api/files/preview', () => {
  it('returns metadata for a real upload', async () => {
    const up = await doUpload(owner, { channelId: channel.id, filename: 'pic.png', type: 'image/png' })
    const res = await PREVIEW_GET(asRequest('GET', '/api/files/preview', {
      cookie: owner.sessionCookie,
      query: { file_id: up.id },
    }))
    const body = await expectSuccess<{ preview: {
      file_id: string; name: string; content_type: string; preview_category: string
      file_url: string; inline_url: string | null
    } }>(res)
    expect(body.preview.file_id).toBe(up.id)
    expect(body.preview.name).toBe('pic.png')
    expect(body.preview.content_type).toBe('image/png')
    expect(body.preview.preview_category).toBe('image')
    // URLs point at the real download route (/api/files/:id/download), not the
    // dead /api/files/download?file_id= path.
    expect(body.preview.file_url).toBe(`/api/files/${up.id}/download`)
    expect(body.preview.inline_url).toBe(`/api/files/${up.id}/download`)
  })

  it('thumbnail_url points at the ?thumb=1 endpoint when thumbnail_key is set', async () => {
    const up = await doUpload(owner, { channelId: channel.id, filename: 'thumbed.png', type: 'image/png' })
    // Simulate the file_thumbnail worker having produced a thumbnail.
    await ctx.pool.query(
      `UPDATE aaelink.file_attachments SET thumbnail_key = $1 WHERE id = $2`,
      [`${up.id}.thumb.webp`, up.id]
    )
    const res = await PREVIEW_GET(asRequest('GET', '/api/files/preview', {
      cookie: owner.sessionCookie,
      query: { file_id: up.id },
    }))
    const body = await expectSuccess<{ preview: { thumbnail_url: string | null } }>(res)
    expect(body.preview.thumbnail_url).toBe(`/api/files/preview?file_id=${up.id}&thumb=1`)
  })

  it('thumbnail_url falls back to the download URL for an image without a thumbnail', async () => {
    // Fresh image upload: thumbnail_key defaults to '' (no worker output yet).
    const up = await doUpload(owner, { channelId: channel.id, filename: 'nothumb.png', type: 'image/png' })
    const res = await PREVIEW_GET(asRequest('GET', '/api/files/preview', {
      cookie: owner.sessionCookie,
      query: { file_id: up.id },
    }))
    const body = await expectSuccess<{ preview: { thumbnail_url: string | null } }>(res)
    expect(body.preview.thumbnail_url).toBe(`/api/files/${up.id}/download`)
  })

  it('?thumb=1 serves the thumbnail bytes (image/webp) when present, not the JSON body', async () => {
    const up = await doUpload(owner, { channelId: channel.id, filename: 'serve.png', type: 'image/png' })
    // Write a real thumbnail object to the local backend + point the row at it.
    const thumbKey = `${up.id}.thumb.webp`
    fs.writeFileSync(path.join(UPLOAD_DIR, thumbKey), Buffer.from('webp-thumb-bytes'))
    await ctx.pool.query(
      `UPDATE aaelink.file_attachments SET thumbnail_key = $1 WHERE id = $2`,
      [thumbKey, up.id]
    )
    try {
      const res = await PREVIEW_GET(asRequest('GET', '/api/files/preview', {
        cookie: owner.sessionCookie,
        query: { file_id: up.id, thumb: '1' },
      }))
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('image/webp')
      const buf = Buffer.from(await res.arrayBuffer())
      expect(buf.toString()).toBe('webp-thumb-bytes')
    } finally {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, thumbKey)) } catch { /* gone */ }
    }
  })

  it('?thumb=1 returns 404 when no thumbnail has been generated', async () => {
    const up = await doUpload(owner, { channelId: channel.id, filename: 'nothumb2.png', type: 'image/png' })
    const res = await PREVIEW_GET(asRequest('GET', '/api/files/preview', {
      cookie: owner.sessionCookie,
      query: { file_id: up.id, thumb: '1' },
    }))
    expect(res.status).toBe(404)
    const body = await res.json() as { error?: string }
    expect(body.error).toBe('thumbnail_not_found')
  })

  it('?thumb=1 forbids a non-uploader without channel access', async () => {
    // Private channel `other` is not a member of → thumbnail ACL must 403.
    const priv = await createTestChannel(ctx.pool, owner.id, { type: 'private' })
    const up = await doUpload(owner, { channelId: priv.id, filename: 'secret.png', type: 'image/png' })
    const thumbKey = `${up.id}.thumb.webp`
    fs.writeFileSync(path.join(UPLOAD_DIR, thumbKey), Buffer.from('x'))
    await ctx.pool.query(
      `UPDATE aaelink.file_attachments SET thumbnail_key = $1 WHERE id = $2`,
      [thumbKey, up.id]
    )
    try {
      const res = await PREVIEW_GET(asRequest('GET', '/api/files/preview', {
        cookie: other.sessionCookie,
        query: { file_id: up.id, thumb: '1' },
      }))
      expect(res.status).toBe(403)
      const body = await res.json() as { error?: string }
      expect(body.error).toBe('forbidden')
    } finally {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, thumbKey)) } catch { /* gone */ }
      await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = $1`, [priv.id])
    }
  })
})

describe('DELETE /api/files', () => {
  it('soft-deletes: list hides it, row survives with deleted_at>0', async () => {
    const up = await doUpload(owner, { channelId: channel.id, filename: 'gone.txt' })

    const del = await FILES_DELETE(asRequest('DELETE', '/api/files', {
      cookie: owner.sessionCookie,
      body: { file_id: up.id },
    }))
    await expectSuccess(del)

    // Not in the list anymore.
    const listRes = await FILES_GET(asRequest('GET', '/api/files', {
      cookie: owner.sessionCookie,
      query: { channel_id: channel.id },
    }))
    const list = await expectSuccess<{ files: Array<{ id: string }> }>(listRes)
    expect(list.files.some(f => f.id === up.id)).toBe(false)

    // Info also hides it.
    const infoRes = await FILES_GET(asRequest('GET', '/api/files', {
      cookie: owner.sessionCookie,
      query: { file_id: up.id },
    }))
    await expectError(infoRes, 404, 'file_not_found')

    // But the row still exists with deleted_at>0 (auditable history).
    const { rows } = await ctx.pool.query<{ deleted_at: string }>(
      `SELECT deleted_at FROM aaelink.file_attachments WHERE id = $1`, [up.id]
    )
    expect(rows[0]).toBeTruthy()
    expect(Number(rows[0].deleted_at)).toBeGreaterThan(0)
  })

  it('rejects non-owner, non-admin', async () => {
    const up = await doUpload(owner, { channelId: channel.id })
    const res = await FILES_DELETE(asRequest('DELETE', '/api/files', {
      cookie: other.sessionCookie,
      body: { file_id: up.id },
    }))
    await expectError(res, 403, 'forbidden')
  })

  it('requires CSRF (noAutoCsrf → csrf error)', async () => {
    const up = await doUpload(owner, { channelId: channel.id })
    const res = await FILES_DELETE(asRequest('DELETE', '/api/files', {
      cookie: owner.sessionCookie,
      body: { file_id: up.id },
      noAutoCsrf: true,
    }))
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error.startsWith('csrf')).toBe(true)
  })
})

// ── Stage B: storage backend + post-upload pipeline ───────────────────

describe('POST /api/files/upload (Stage B pipeline)', () => {
  it('records storage_backend=local and writes bytes to disk (S3 unconfigured)', async () => {
    const up = await doUpload(owner, { channelId: channel.id, filename: 'bytes.txt' })
    const { rows } = await ctx.pool.query<{ storage_key: string; storage_backend: string }>(
      `SELECT storage_key, storage_backend FROM aaelink.file_attachments WHERE id = $1`, [up.id]
    )
    expect(rows[0].storage_backend).toBe('local')
    expect(fs.existsSync(path.join(UPLOAD_DIR, rows[0].storage_key))).toBe(true)
  })

  it('enqueues file_scan + file_index jobs and a pending file_scans row', async () => {
    const up = await doUpload(owner, { channelId: channel.id, filename: 'pipeline.txt' })

    const { rows: jobs } = await ctx.pool.query<{ type: string; payload: string }>(
      `SELECT type, payload FROM aaelink.jobs WHERE payload LIKE $1`, [`%${up.id}%`]
    )
    const types = jobs.map(j => j.type)
    expect(types).toContain('file_scan')
    expect(types).toContain('file_index')

    // A pending scan row exists for the D12 gate / scan worker.
    const { rows: scans } = await ctx.pool.query<{ result: string }>(
      `SELECT result FROM aaelink.file_scans WHERE file_id = $1`, [up.id]
    )
    expect(scans.length).toBeGreaterThan(0)
    expect(scans.some(s => s.result === 'pending')).toBe(true)
  })
})

describe('DELETE /api/files (Stage B physical cleanup)', () => {
  it('removes the underlying local file after soft-delete', async () => {
    const up = await doUpload(owner, { channelId: channel.id, filename: 'purge.txt' })
    const { rows } = await ctx.pool.query<{ storage_key: string }>(
      `SELECT storage_key FROM aaelink.file_attachments WHERE id = $1`, [up.id]
    )
    const full = path.join(UPLOAD_DIR, rows[0].storage_key)
    expect(fs.existsSync(full)).toBe(true)

    const del = await FILES_DELETE(asRequest('DELETE', '/api/files', {
      cookie: owner.sessionCookie,
      body: { file_id: up.id },
    }))
    await expectSuccess(del)

    // Physical object gone; the soft-deleted row survives for audit.
    expect(fs.existsSync(full)).toBe(false)
    const { rows: after } = await ctx.pool.query<{ deleted_at: string }>(
      `SELECT deleted_at FROM aaelink.file_attachments WHERE id = $1`, [up.id]
    )
    expect(Number(after[0].deleted_at)).toBeGreaterThan(0)
  })
})

describe('GET /api/files/[id]/download (access control)', () => {
  function downloadReq(cookie: string): Parameters<typeof DOWNLOAD_GET>[0] {
    ;(globalThis as { __TEST_COOKIE_HEADER__?: string }).__TEST_COOKIE_HEADER__ = cookie
    const headers = new Headers()
    headers.set('cookie', cookie)
    return new Request('http://localhost:3040/api/files/x/download', { headers }) as unknown as Parameters<typeof DOWNLOAD_GET>[0]
  }
  const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) })

  it('serves the uploader their own unattached file', async () => {
    const up = await doUpload(owner, { filename: 'mine.txt' })
    const res = await DOWNLOAD_GET(downloadReq(owner.sessionCookie), ctxFor(up.id))
    expect(res.status).toBe(200)
  })

  it('403s a non-uploader on an unattached (private) file', async () => {
    const up = await doUpload(owner, { filename: 'private.txt' })
    const res = await DOWNLOAD_GET(downloadReq(other.sessionCookie), ctxFor(up.id))
    expect(res.status).toBe(403)
    const body = await res.json() as { error?: string }
    expect(body.error).toBe('forbidden')
  })

  it('serves a channel-attached file to a workspace member of an open channel', async () => {
    // `other` joins the channel's workspace — open channels readable by any member.
    const { rows: [ws] } = await ctx.pool.query<{ workspace_id: string }>(
      `SELECT workspace_id FROM aaelink.channels WHERE id = $1`, [channel.id]
    )
    await ctx.pool.query(
      `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
      [ws.workspace_id, other.id]
    )
    const up = await doUpload(owner, { channelId: channel.id, filename: 'shared.txt' })
    const res = await DOWNLOAD_GET(downloadReq(other.sessionCookie), ctxFor(up.id))
    expect(res.status).toBe(200)
  })

  it('403s a non-member on a private-channel file', async () => {
    const priv = await createTestChannel(ctx.pool, owner.id, { type: 'private' })
    const up = await doUpload(owner, { channelId: priv.id, filename: 'secret.txt' })
    const res = await DOWNLOAD_GET(downloadReq(other.sessionCookie), ctxFor(up.id))
    expect(res.status).toBe(403)
    await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = $1`, [priv.id])
  })

  it('404s a soft-deleted file even for the uploader', async () => {
    const up = await doUpload(owner, { channelId: channel.id, filename: 'gone.txt' })
    await expectSuccess(await FILES_DELETE(asRequest('DELETE', '/api/files', {
      cookie: owner.sessionCookie, body: { file_id: up.id },
    })))
    const res = await DOWNLOAD_GET(downloadReq(owner.sessionCookie), ctxFor(up.id))
    expect(res.status).toBe(404)
  })
})
