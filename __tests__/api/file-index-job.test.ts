/**
 * Integration test for the file_index extraction job (Stage B).
 *
 * runFileIndex reads a stored file's bytes and populates aaelink.file_index
 * (content_preview + search_vector) so GET /api/search/files can find it. This
 * exercises the worker-side handler against a live Postgres + local disk:
 *   - text content → preview + a search_vector that matches a tsquery term
 *   - non-text content → an empty preview row (indexed=false), still UPSERTed
 *   - re-run is idempotent (UPSERT by file_id)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import { runFileIndex } from '@/lib/files/fileIndexJob'

const UPLOAD_DIR = process.env.AAELINK_UPLOAD_DIR || path.join(process.cwd(), '.uploads')

let ctx: TestContext
let owner: TestUser
const userIds: string[] = []
const fileIds: string[] = []
const storageKeys: string[] = []

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
  if (fileIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.file_index WHERE file_id = ANY($1)`, [fileIds])
    await ctx.pool.query(`DELETE FROM aaelink.file_attachments WHERE id = ANY($1)`, [fileIds])
  }
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('runFileIndex', () => {
  it('indexes text content with a searchable vector', async () => {
    const id = await mkLocalFile(
      Buffer.from('the quick brown aardvark jumps over the lazy dog'),
      'text/plain',
      'doc.txt'
    )
    const res = await runFileIndex(ctx.pool, { file_id: id })
    expect(res.indexed).toBe(true)
    expect(res.contentLength).toBeGreaterThan(0)

    const { rows } = await ctx.pool.query<{ content_preview: string }>(
      `SELECT content_preview FROM aaelink.file_index WHERE file_id = $1`, [id]
    )
    expect(rows[0].content_preview).toContain('aardvark')

    // The search_vector is populated and matches a term.
    const { rows: match } = await ctx.pool.query<{ hit: boolean }>(
      `SELECT (search_vector @@ to_tsquery('english', 'aardvark')) AS hit
         FROM aaelink.file_index WHERE file_id = $1`, [id]
    )
    expect(match[0].hit).toBe(true)
  })

  it('writes an empty preview row for non-text content', async () => {
    const id = await mkLocalFile(Buffer.from([0, 1, 2, 3, 255]), 'image/png', 'pic.png')
    const res = await runFileIndex(ctx.pool, { file_id: id })
    expect(res.indexed).toBe(false)
    const { rows } = await ctx.pool.query<{ content_preview: string; file_type: string }>(
      `SELECT content_preview, file_type FROM aaelink.file_index WHERE file_id = $1`, [id]
    )
    expect(rows[0]).toBeTruthy()
    expect(rows[0].content_preview).toBe('')
    expect(rows[0].file_type).toBe('png')
  })

  it('is idempotent — re-running UPSERTs by file_id', async () => {
    const id = await mkLocalFile(Buffer.from('hello reindex'), 'text/plain', 'r.txt')
    await runFileIndex(ctx.pool, { file_id: id })
    await runFileIndex(ctx.pool, { file_id: id })
    const { rows } = await ctx.pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM aaelink.file_index WHERE file_id = $1`, [id]
    )
    expect(Number(rows[0].n)).toBe(1)
  })

  it('throws for an unknown file', async () => {
    await expect(runFileIndex(ctx.pool, { file_id: 'nope' })).rejects.toThrow()
  })
})
