/**
 * Integration tests for /api/emoji
 *
 * Tests:
 *   - GET  — list workspace emoji (requires workspace_id query param)
 *   - POST — create custom emoji (requires workspace_id + name + image_url in body)
 *   - DELETE — remove custom emoji
 *   - Auth guard
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, asRequest,
  expectSuccess, cleanupTestData,
  TestContext, TestUser
} from '../helpers'

let ctx: TestContext
let user: TestUser
let workspaceId: string
const createdIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(user.id)

  // Create a workspace and add user as member
  workspaceId = randomUUID()
  const now = Date.now()
  await ctx.pool.query(
    `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system)
     VALUES ($1, $2, $3, $4, $5, false)`,
    [workspaceId, `emoji-ws-${workspaceId.slice(0, 8)}`, 'Emoji Test WS', user.id, now]
  )
  await ctx.pool.query(
    `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
    [workspaceId, user.id]
  )
})

afterAll(async () => {
  await cleanupTestData(ctx.pool, createdIds)
  if (workspaceId) {
    await ctx.pool.query(`DELETE FROM aaelink.custom_emoji WHERE workspace_id = $1`, [workspaceId])
    await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE workspace_id = $1`, [workspaceId])
    await ctx.pool.query(`DELETE FROM aaelink.workspaces WHERE id = $1`, [workspaceId])
  }
  await ctx.cleanup()
})

describe('GET /api/emoji', () => {
  it('returns 401 without auth', async () => {
    const { GET } = await import('@/app/api/emoji/route')
    const req = asRequest('GET', '/api/emoji')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns emoji list for authenticated user', async () => {
    const { GET } = await import('@/app/api/emoji/route')
    const req = asRequest('GET', '/api/emoji', {
      cookie: user.sessionCookie,
      query: { workspace_id: workspaceId },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ emoji: unknown[] }>(res)
    expect(body).toHaveProperty('emoji')
    expect(Array.isArray(body.emoji)).toBe(true)
  })
})

describe('POST /api/emoji', () => {
  let emojiId: string

  it('creates a custom emoji', async () => {
    const { POST } = await import('@/app/api/emoji/route')
    const req = asRequest('POST', '/api/emoji', {
      cookie: user.sessionCookie,
      body: {
        workspace_id: workspaceId,
        name: 'test_rocket',
        image_url: 'https://example.com/rocket.png',
      },
    })
    const res = await POST(req)
    expect([200, 201]).toContain(res.status)
    const body = await expectSuccess<{ emoji: { id: string } }>(res)
    expect(body.emoji).toHaveProperty('id')
    emojiId = body.emoji.id
  })

  it('rejects duplicate emoji name', async () => {
    const { POST } = await import('@/app/api/emoji/route')
    const req = asRequest('POST', '/api/emoji', {
      cookie: user.sessionCookie,
      body: {
        workspace_id: workspaceId,
        name: 'test_rocket',
        image_url: 'https://example.com/rocket2.png',
      },
    })
    const res = await POST(req)
    expect([400, 409]).toContain(res.status)
  })
})

describe('DELETE /api/emoji', () => {
  it('returns 401 without auth', async () => {
    const { DELETE: DEL } = await import('@/app/api/emoji/route')
    const req = asRequest('DELETE', '/api/emoji', { query: { id: 'fake' } })
    const res = await DEL(req)
    expect(res.status).toBe(401)
  })
})
