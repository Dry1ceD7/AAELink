/**
 * Integration tests for /api/search/files (real Postgres FTS on file_index).
 *
 * Verifies that a file indexed into aaelink.file_index (via the route's POST
 * direct-index path) is found by GET /api/search/files using to_tsquery against
 * the stored search_vector, with a ts_headline highlight. Also covers auth and
 * the min-length guard.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, asRequest,
  expectSuccess, cleanupTestData,
  TestContext, TestUser
} from '../helpers'

type FileHit = {
  id: string; file_id: string; filename: string; file_type: string
  channel_id: string; highlights?: string; relevance?: number
}
type FilesBody = { results: FileHit[]; total: number; query: string }

let ctx: TestContext
let caller: TestUser
const createdIds: string[] = []
const fileIds: string[] = []

// Unique token so this suite's content never collides with other rows.
const TOKEN = `quokka${randomUUID().slice(0, 8)}`

beforeAll(async () => {
  ctx = await createTestContext()
  caller = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(caller.id)
})

afterAll(async () => {
  if (fileIds.length) await ctx.pool.query(`DELETE FROM aaelink.file_index WHERE file_id = ANY($1)`, [fileIds])
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('GET /api/search/files — file content FTS', () => {
  it('returns 401 without a session', async () => {
    const { GET } = await import('@/app/api/search/files/route')
    const res = await GET(asRequest('GET', '/api/search/files', { query: { q: TOKEN } }))
    expect(res.status).toBe(401)
  })

  it('rejects a too-short query (min 2 chars)', async () => {
    const { GET } = await import('@/app/api/search/files/route')
    const res = await GET(asRequest('GET', '/api/search/files', {
      cookie: caller.sessionCookie, query: { q: 'a' }
    }))
    expect(res.status).toBe(400)
  })

  it('finds an indexed file by its content and highlights the match', async () => {
    const { POST, GET } = await import('@/app/api/search/files/route')

    // Direct-index a file via the route's content path (UPSERTs into file_index
    // with a generated search_vector). This is the runFileIndex equivalent the
    // files epic added on the worker side; here we seed inline.
    const fileId = randomUUID()
    fileIds.push(fileId)
    const postRes = await POST(asRequest('POST', '/api/search/files', {
      cookie: caller.sessionCookie,
      body: {
        file_id: fileId,
        filename: 'notes.txt',
        file_type: 'txt',
        content: `meeting notes mentioning the ${TOKEN} runbook several times`,
      },
    }))
    expect(postRes.status).toBe(201)

    const res = await GET(asRequest('GET', '/api/search/files', {
      cookie: caller.sessionCookie, query: { q: TOKEN, limit: '20' }
    }))
    const body = await expectSuccess<FilesBody>(res)
    const hit = body.results.find(r => r.file_id === fileId)
    expect(hit).toBeDefined()
    expect(hit!.filename).toBe('notes.txt')
    // ts_headline wraps the matched token in <mark>…</mark>.
    expect(hit!.highlights || '').toContain('<mark>')
  })

  it('does not return files whose content does not match', async () => {
    const { POST, GET } = await import('@/app/api/search/files/route')
    const fileId = randomUUID()
    fileIds.push(fileId)
    await POST(asRequest('POST', '/api/search/files', {
      cookie: caller.sessionCookie,
      body: {
        file_id: fileId,
        filename: 'unrelated.txt',
        file_type: 'txt',
        content: 'this document is about something entirely different',
      },
    }))

    const res = await GET(asRequest('GET', '/api/search/files', {
      cookie: caller.sessionCookie, query: { q: TOKEN, limit: '20' }
    }))
    const body = await expectSuccess<FilesBody>(res)
    expect(body.results.map(r => r.file_id)).not.toContain(fileId)
  })
})
