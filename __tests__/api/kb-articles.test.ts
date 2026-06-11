/**
 * Integration test for KB article RBAC (/api/kb/articles/[id]).
 * Only the author or a platform admin may edit/delete an article.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, asRequest, expectSuccess, expectError, cleanupTestData,
  TestContext, TestUser,
} from '../helpers'

let ctx: TestContext
let author: TestUser
let other: TestUser
let admin: TestUser
let wsId: string
let articleId: string
const createdIds: string[] = []

const paramsFor = (id: string) => ({ params: Promise.resolve({ id }) })

beforeAll(async () => {
  ctx = await createTestContext()
  author = await createTestUser(ctx.pool, { role: 'employee' })
  other = await createTestUser(ctx.pool, { role: 'employee' })
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  createdIds.push(author.id, other.id, admin.id)

  const { rows: [m] } = await ctx.pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.workspace_members WHERE user_id = $1 LIMIT 1`, [author.id]
  )
  wsId = m.workspace_id

  articleId = randomUUID()
  const now = Date.now()
  await ctx.pool.query(
    `INSERT INTO aaelink.kb_articles (id, workspace_id, title, content, author_id, is_published, view_count, created_at, updated_at)
     VALUES ($1, $2, 'Doc', 'body', $3, true, 0, $4, $4)`,
    [articleId, wsId, author.id, now]
  )
})

afterAll(async () => {
  await ctx.pool.query(`DELETE FROM aaelink.kb_articles WHERE author_id = ANY($1)`, [createdIds])
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('KB article edit/delete RBAC', () => {
  it('forbids a non-author non-admin from editing', async () => {
    const { PATCH } = await import('@/app/api/kb/articles/[id]/route')
    const res = await PATCH(
      asRequest('PATCH', `/api/kb/articles/${articleId}`, { cookie: other.sessionCookie, body: { title: 'Hacked' } }),
      paramsFor(articleId)
    )
    await expectError(res, 403, 'forbidden')
  })

  it('lets the author edit', async () => {
    const { PATCH } = await import('@/app/api/kb/articles/[id]/route')
    const res = await PATCH(
      asRequest('PATCH', `/api/kb/articles/${articleId}`, { cookie: author.sessionCookie, body: { title: 'Updated' } }),
      paramsFor(articleId)
    )
    await expectSuccess(res)
  })

  it('forbids a non-author non-admin from deleting', async () => {
    const { DELETE } = await import('@/app/api/kb/articles/[id]/route')
    const res = await DELETE(
      asRequest('DELETE', `/api/kb/articles/${articleId}`, { cookie: other.sessionCookie }),
      paramsFor(articleId)
    )
    await expectError(res, 403, 'forbidden')
  })

  it('lets a platform admin delete', async () => {
    const { DELETE } = await import('@/app/api/kb/articles/[id]/route')
    const res = await DELETE(
      asRequest('DELETE', `/api/kb/articles/${articleId}`, { cookie: admin.sessionCookie }),
      paramsFor(articleId)
    )
    await expectSuccess(res)
  })
})
