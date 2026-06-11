/**
 * Integration tests for /api/kb/categories — create + DELETE (Stage A).
 *
 * Covers:
 *   - create writes a category and audits it
 *   - DELETE by the creator works and is audited
 *   - DELETE refuses (409) while an article still references the category
 *   - DELETE forbidden for a non-creator non-admin
 *   - DELETE allowed for a platform admin
 *   - CSRF negative
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, ensureSystemWorkspace, asRequest,
  expectSuccess, cleanupTestData, TestContext, TestUser,
} from '../helpers'

let ctx: TestContext
let author: TestUser
let outsider: TestUser
let admin: TestUser
let wsId: string
const userIds: string[] = []
const catIds: string[] = []
const articleIds: string[] = []

async function importRoute() {
  return import('@/app/api/kb/categories/route')
}

beforeAll(async () => {
  ctx = await createTestContext()
  author = await createTestUser(ctx.pool, { role: 'employee' })
  outsider = await createTestUser(ctx.pool, { role: 'employee' })
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  userIds.push(author.id, outsider.id, admin.id)
  wsId = await ensureSystemWorkspace(ctx.pool)
})

afterAll(async () => {
  if (articleIds.length) await ctx.pool.query(`DELETE FROM aaelink.kb_articles WHERE id = ANY($1)`, [articleIds])
  if (catIds.length) await ctx.pool.query(`DELETE FROM aaelink.kb_categories WHERE id = ANY($1)`, [catIds])
  await cleanupTestData(ctx.pool, userIds)
  await ctx.cleanup()
})

/**
 * Poll for an audit row. writeAuditLog is fire-and-forget (not awaited by the
 * handler), so the INSERT may land a tick after the HTTP response — poll briefly
 * rather than asserting synchronously.
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

async function createCategory(cookie: string): Promise<string> {
  const { POST } = await importRoute()
  const res = await POST(asRequest('POST', '/api/kb/categories', {
    cookie, body: { workspace_id: wsId, name: `Cat ${randomUUID().slice(0, 6)}` },
  }))
  const body = await expectSuccess<{ id: string }>(res)
  catIds.push(body.id)
  return body.id
}

describe('POST /api/kb/categories', () => {
  it('requires auth', async () => {
    const { POST } = await importRoute()
    const res = await POST(asRequest('POST', '/api/kb/categories', { body: { workspace_id: wsId, name: 'X' } }))
    expect(res.status).toBe(401)
  })

  it('creates a category and writes an audit row', async () => {
    const id = await createCategory(author.sessionCookie)
    expect(await waitForAudit('kb.category.create', id)).toBe(true)
  })
})

describe('DELETE /api/kb/categories', () => {
  it('lets the creator delete an empty category and audits it', async () => {
    const id = await createCategory(author.sessionCookie)
    const { DELETE } = await importRoute()
    const res = await DELETE(asRequest('DELETE', '/api/kb/categories', { cookie: author.sessionCookie, body: { id } }))
    expect(res.status).toBe(200)
    expect(await waitForAudit('kb.category.delete', id)).toBe(true)
  })

  it('refuses (409) while an article still references the category', async () => {
    const id = await createCategory(author.sessionCookie)
    const articleId = randomUUID()
    const now = Date.now()
    await ctx.pool.query(
      `INSERT INTO aaelink.kb_articles (id, workspace_id, category_id, title, content, author_id, is_published, created_at, updated_at)
       VALUES ($1, $2, $3, 'A', 'B', $4, true, $5, $5)`,
      [articleId, wsId, id, author.id, now]
    )
    articleIds.push(articleId)

    const { DELETE } = await importRoute()
    const res = await DELETE(asRequest('DELETE', '/api/kb/categories', { cookie: author.sessionCookie, body: { id } }))
    expect(res.status).toBe(409)
  })

  it('forbids a non-creator, non-admin', async () => {
    const id = await createCategory(author.sessionCookie)
    const { DELETE } = await importRoute()
    const res = await DELETE(asRequest('DELETE', '/api/kb/categories', { cookie: outsider.sessionCookie, body: { id } }))
    expect(res.status).toBe(403)
  })

  it('lets a platform admin delete someone else\'s category', async () => {
    const id = await createCategory(author.sessionCookie)
    const { DELETE } = await importRoute()
    const res = await DELETE(asRequest('DELETE', '/api/kb/categories', { cookie: admin.sessionCookie, body: { id } }))
    expect(res.status).toBe(200)
  })

  it('rejects DELETE without a CSRF token', async () => {
    const id = await createCategory(author.sessionCookie)
    const { DELETE } = await importRoute()
    const res = await DELETE(asRequest('DELETE', '/api/kb/categories', { cookie: author.sessionCookie, body: { id }, noAutoCsrf: true }))
    expect(res.status).toBe(403)
  })
})

describe('workspace membership is enforced (cross-workspace isolation)', () => {
  const otherWsId = `kb-other-ws-${randomUUID().slice(0, 8)}`

  beforeAll(async () => {
    // A workspace `author` is NOT a member of, owned by a fixed bootstrap user.
    await ctx.pool.query(
      `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system)
       VALUES ($1, $2, $2, $3, $4, false) ON CONFLICT (id) DO NOTHING`,
      [otherWsId, `other-${otherWsId.slice(0, 6)}`, admin.id, Date.now()]
    )
  })

  afterAll(async () => {
    await ctx.pool.query(`DELETE FROM aaelink.kb_categories WHERE workspace_id = $1`, [otherWsId])
    await ctx.pool.query(`DELETE FROM aaelink.workspaces WHERE id = $1`, [otherWsId])
  })

  it('forbids creating a category in a workspace the caller is not a member of', async () => {
    const { POST } = await importRoute()
    const res = await POST(asRequest('POST', '/api/kb/categories', {
      cookie: author.sessionCookie, body: { workspace_id: otherWsId, name: 'Sneaky' },
    }))
    expect(res.status).toBe(403)
  })

  it('forbids listing categories of a workspace the caller is not a member of', async () => {
    const { GET } = await importRoute()
    const res = await GET(asRequest('GET', '/api/kb/categories', {
      cookie: author.sessionCookie, query: { workspace_id: otherWsId },
    }))
    expect(res.status).toBe(403)
  })

  it('forbids deleting a category in a workspace the caller is not a member of', async () => {
    // Seed a category in the other workspace directly (author is its creator on
    // paper but NOT a member of the workspace — the membership gate must still 403).
    const catId = randomUUID()
    const now = Date.now()
    await ctx.pool.query(
      `INSERT INTO aaelink.kb_categories (id, workspace_id, name, description, created_by, created_at, updated_at)
       VALUES ($1, $2, 'Foreign', '', $3, $4, $4)`,
      [catId, otherWsId, author.id, now]
    )
    const { DELETE } = await importRoute()
    const res = await DELETE(asRequest('DELETE', '/api/kb/categories', {
      cookie: author.sessionCookie, body: { id: catId },
    }))
    expect(res.status).toBe(403)
  })
})
