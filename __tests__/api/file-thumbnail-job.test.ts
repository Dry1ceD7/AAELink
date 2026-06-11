/**
 * Integration test for the file_thumbnail metadata/thumbnail job (Stage B).
 *
 * runFileThumbnail reads a stored file's bytes, sniffs image dimensions with the
 * pure-JS extractImageMeta, and UPDATEs file_attachments.width/height. It also
 * (when sharp is available + the media policy allows) generates a WebP thumbnail
 * and records thumbnail_key. This exercises the worker-side handler against a
 * live Postgres + local disk:
 *   - a real PNG → width/height persisted from the IHDR
 *   - a non-image (text) → no-op, columns stay null
 *   - a soft-deleted row → no-op
 *   - re-run is idempotent
 *
 * The thumbnail (sharp) step is asserted leniently: sharp is an optional native
 * dep, so we only require thumbnail_key to be set IF a thumbnail was produced —
 * dimensions are the deterministic contract this test pins down.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import { runFileThumbnail } from '@/lib/files/thumbnailJob'

const UPLOAD_DIR = process.env.AAELINK_UPLOAD_DIR || path.join(process.cwd(), '.uploads')

let ctx: TestContext
let owner: TestUser
const userIds: string[] = []
const fileIds: string[] = []
const storageKeys: string[] = []

/** Minimal valid PNG (IHDR width/height only — extractImageMeta reads offsets 16/20). */
function makePng(width: number, height: number): Buffer {
  const beU32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n, 0); return b }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    beU32(13),
    Buffer.from('IHDR', 'ascii'),
    beU32(width),
    beU32(height),
    Buffer.from([8, 2, 0, 0, 0]),
  ])
}

async function mkLocalFile(content: Buffer, contentType: string, filename: string): Promise<string> {
  const id = randomUUID()
  const storageKey = `${id}${path.extname(filename) || '.bin'}`
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  fs.writeFileSync(path.join(UPLOAD_DIR, storageKey), content)
  storageKeys.push(storageKey)
  await ctx.pool.query(
    `INSERT INTO aaelink.file_attachments
       (id, message_id, channel_id, user_id, filename, content_type, size, storage_key, storage_backend, created_at)
     VALUES ($1, NULL, NULL, $2, $3, $4, $5, $6, 'local', $7)`,
    [id, owner.id, filename, contentType, content.length, storageKey, Date.now()]
  )
  fileIds.push(id)
  return id
}

beforeAll(async () => {
  ctx = await createTestContext()
  owner = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(owner.id)
})

afterAll(async () => {
  for (const k of storageKeys) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, k)) } catch { /* gone */ }
  }
  // Best-effort cleanup of any generated thumbnails (local backend keys).
  for (const id of fileIds) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, `${id}.thumb.webp`)) } catch { /* none */ }
  }
  if (fileIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.file_attachments WHERE id = ANY($1)`, [fileIds])
  }
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('runFileThumbnail', () => {
  it('persists width/height for a real PNG', async () => {
    const id = await mkLocalFile(makePng(320, 240), 'image/png', 'pic.png')
    const res = await runFileThumbnail(ctx.pool, { file_id: id })
    expect(res.dimensionsSaved).toBe(true)
    expect(res.width).toBe(320)
    expect(res.height).toBe(240)

    const { rows } = await ctx.pool.query<{ width: string | null; height: string | null; thumbnail_key: string | null }>(
      `SELECT width::text, height::text, thumbnail_key FROM aaelink.file_attachments WHERE id = $1`, [id]
    )
    expect(rows[0].width).toBe('320')
    expect(rows[0].height).toBe('240')
    // thumbnail_key is only set when sharp produced a thumbnail; tolerate either.
    if (res.thumbnailSaved) expect(rows[0].thumbnail_key).toBeTruthy()
  })

  it('no-ops on non-image content (columns stay null)', async () => {
    const id = await mkLocalFile(Buffer.from('just some plain text, not an image'), 'text/plain', 'note.txt')
    const res = await runFileThumbnail(ctx.pool, { file_id: id })
    expect(res.dimensionsSaved).toBe(false)
    expect(res.thumbnailSaved).toBe(false)
    const { rows } = await ctx.pool.query<{ width: string | null; height: string | null }>(
      `SELECT width::text, height::text FROM aaelink.file_attachments WHERE id = $1`, [id]
    )
    expect(rows[0].width).toBeNull()
    expect(rows[0].height).toBeNull()
  })

  it('no-ops on a soft-deleted row', async () => {
    const id = await mkLocalFile(makePng(10, 10), 'image/png', 'del.png')
    await ctx.pool.query(`UPDATE aaelink.file_attachments SET deleted_at = $1 WHERE id = $2`, [Date.now(), id])
    const res = await runFileThumbnail(ctx.pool, { file_id: id })
    expect(res.dimensionsSaved).toBe(false)
    const { rows } = await ctx.pool.query<{ width: string | null }>(
      `SELECT width::text FROM aaelink.file_attachments WHERE id = $1`, [id]
    )
    expect(rows[0].width).toBeNull()
  })

  it('is idempotent — re-running keeps the same dimensions', async () => {
    const id = await mkLocalFile(makePng(50, 70), 'image/png', 'idem.png')
    await runFileThumbnail(ctx.pool, { file_id: id })
    const second = await runFileThumbnail(ctx.pool, { file_id: id })
    expect(second.width).toBe(50)
    expect(second.height).toBe(70)
    const { rows } = await ctx.pool.query<{ width: string | null; height: string | null }>(
      `SELECT width::text, height::text FROM aaelink.file_attachments WHERE id = $1`, [id]
    )
    expect(rows[0].width).toBe('50')
    expect(rows[0].height).toBe('70')
  })

  it('returns no-op for an unknown file (no throw)', async () => {
    const res = await runFileThumbnail(ctx.pool, { file_id: randomUUID() })
    expect(res.dimensionsSaved).toBe(false)
    expect(res.thumbnailSaved).toBe(false)
  })
})
