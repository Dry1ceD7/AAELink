/**
 * Integration test for GET /api/files/public/:token byte serving (Stage B).
 *
 * The public link endpoint now renders the actual file (Slack parity) instead of
 * returning metadata only. This exercises the route end to end against a live
 * Postgres with the local storage backend: a real on-disk object is created, a
 * public link minted, and the route is asserted to stream the bytes back. The
 * scan gate must permit it (clean), and ?meta=1 still returns metadata JSON.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { NextRequest } from 'next/server'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import { createPublicLink, setFileSharingPolicy } from '@/lib/files/publicLinks'
import { recordScanResult } from '@/lib/files/scanGate'
import { GET as PUBLIC_GET } from '@/app/api/files/public/[token]/route'

const UPLOAD_DIR = process.env.AAELINK_UPLOAD_DIR || path.join(process.cwd(), '.uploads')

let ctx: TestContext
let owner: TestUser
const userIds: string[] = []
const fileIds: string[] = []
const storageKeys: string[] = []

const BYTES = Buffer.from('public-link-served-bytes-123')

/** Create a clean file with real bytes on the local disk backend. */
async function mkLocalFile(filename = 'public.txt', contentType = 'text/plain'): Promise<string> {
  const id = randomUUID()
  const storageKey = `${id}.txt`
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  fs.writeFileSync(path.join(UPLOAD_DIR, storageKey), BYTES)
  storageKeys.push(storageKey)

  await ctx.pool.query(
    `INSERT INTO aaelink.file_attachments
       (id, message_id, channel_id, user_id, filename, content_type, size, storage_key, storage_backend, created_at)
     VALUES ($1, NULL, NULL, $2, $3, $4, $5, $6, 'local', $7)`,
    [id, owner.id, filename, contentType, BYTES.length, storageKey, Date.now()]
  )
  fileIds.push(id)
  // Mark clean so the D12 scan gate permits serving.
  await recordScanResult(ctx.pool, { fileId: id, result: 'clean' })
  return id
}

beforeAll(async () => {
  ctx = await createTestContext()
  owner = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(owner.id)
})

afterAll(async () => {
  await setFileSharingPolicy(ctx.pool, { public_links_enabled: true })
  for (const k of storageKeys) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, k)) } catch { /* already gone */ }
  }
  if (fileIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.file_public_links WHERE file_id = ANY($1)`, [fileIds])
    await ctx.pool.query(`DELETE FROM aaelink.file_scans WHERE file_id = ANY($1)`, [fileIds])
    await ctx.pool.query(`DELETE FROM aaelink.file_attachments WHERE id = ANY($1)`, [fileIds])
  }
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

type RouteCtx = Parameters<typeof PUBLIC_GET>[1]
function reqFor(token: string, query = ''): Parameters<typeof PUBLIC_GET>[0] {
  // The route reads req.nextUrl.searchParams, so build a real NextRequest.
  return new NextRequest(`http://localhost:3040/api/files/public/${token}${query}`) as unknown as Parameters<typeof PUBLIC_GET>[0]
}
function ctxFor(token: string): RouteCtx {
  return { params: Promise.resolve({ token }) } as RouteCtx
}

describe('GET /api/files/public/:token — byte serving', () => {
  it('serves the actual file bytes for a valid token (local backend)', async () => {
    const fileId = await mkLocalFile()
    const link = await createPublicLink(ctx.pool, owner.id, fileId)
    if (!link.ok) throw new Error('createPublicLink failed')

    const res = await PUBLIC_GET(reqFor(link.token), ctxFor(link.token))
    expect(res.status).toBe(200)
    // text/plain is not inline-safe: served as an attachment download with a
    // generic type + nosniff so unauthenticated active content can't render.
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('content-disposition')).toContain('attachment')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    const buf = Buffer.from(await res.arrayBuffer())
    expect(Buffer.compare(buf, BYTES)).toBe(0)
  })

  it('neutralizes active-content types (text/html) on the unauthenticated path', async () => {
    const fileId = await mkLocalFile('xss.html', 'text/html')
    const link = await createPublicLink(ctx.pool, owner.id, fileId)
    if (!link.ok) throw new Error('createPublicLink failed')

    const res = await PUBLIC_GET(reqFor(link.token), ctxFor(link.token))
    expect(res.status).toBe(200)
    // Never serve uploader-controlled HTML as text/html inline — that would be a
    // same-origin stored-content surface.
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('content-disposition')).toContain('attachment')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('serves inline-safe media (image/png) inline with its declared type', async () => {
    const fileId = await mkLocalFile('pic.png', 'image/png')
    const link = await createPublicLink(ctx.pool, owner.id, fileId)
    if (!link.ok) throw new Error('createPublicLink failed')

    const res = await PUBLIC_GET(reqFor(link.token), ctxFor(link.token))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('content-disposition')).toContain('inline')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('?meta=1 still returns metadata JSON', async () => {
    const fileId = await mkLocalFile('meta.txt')
    const link = await createPublicLink(ctx.pool, owner.id, fileId)
    if (!link.ok) throw new Error('createPublicLink failed')

    const res = await PUBLIC_GET(reqFor(link.token, '?meta=1'), ctxFor(link.token))
    expect(res.status).toBe(200)
    const body = await res.json() as { file: { id: string; filename: string; size: number } }
    expect(body.file.id).toBe(fileId)
    expect(body.file.filename).toBe('meta.txt')
    expect(body.file.size).toBe(BYTES.length)
  })

  it('404s for an unknown token', async () => {
    const res = await PUBLIC_GET(reqFor('flink_nope'), ctxFor('flink_nope'))
    expect(res.status).toBe(404)
  })

  it('404s when external sharing is disabled', async () => {
    const fileId = await mkLocalFile('off.txt')
    const link = await createPublicLink(ctx.pool, owner.id, fileId)
    if (!link.ok) throw new Error('createPublicLink failed')
    await setFileSharingPolicy(ctx.pool, { public_links_enabled: false })
    const res = await PUBLIC_GET(reqFor(link.token), ctxFor(link.token))
    expect(res.status).toBe(404)
    await setFileSharingPolicy(ctx.pool, { public_links_enabled: true })
  })
})
