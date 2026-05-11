/**
 * Integration tests for /api/lists
 *
 * Tests:
 *   - GET  — list items (optionally scoped to channel)
 *   - POST — add item
 *   - POST — update item status
 *   - POST — delete item
 *   - Auth guard
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext, createTestUser, createTestChannel, asRequest,
  expectSuccess, cleanupTestData,
  TestContext, TestUser
} from '../helpers'

let ctx: TestContext
let user: TestUser
let channelId: string
const createdIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  const ch = await createTestChannel(ctx.pool, user.id, { name: 'list-test-ch' })
  channelId = ch.id
  createdIds.push(user.id)
})

afterAll(async () => {
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('GET /api/lists', () => {
  it('returns 401 without auth', async () => {
    const { GET } = await import('@/app/api/lists/route')
    const req = asRequest('GET', '/api/lists')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns items list', async () => {
    const { GET } = await import('@/app/api/lists/route')
    const req = asRequest('GET', '/api/lists', { cookie: user.sessionCookie })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ items: unknown[] }>(res)
    expect(body).toHaveProperty('items')
    expect(Array.isArray(body.items)).toBe(true)
  })
})

describe('POST /api/lists', () => {
  let itemId: string

  it('adds a list item', async () => {
    const { POST } = await import('@/app/api/lists/route')
    const req = asRequest('POST', '/api/lists', {
      cookie: user.sessionCookie,
      body: {
        action: 'add_item',
        channel_id: channelId,
        title: 'Test Task Alpha',
        status: 'todo',
        priority: 'high',
      },
    })
    const res = await POST(req)
    expect([200, 201]).toContain(res.status)
    const body = await expectSuccess<{ item: { id: string } }>(res)
    expect(body.item).toHaveProperty('id')
    itemId = body.item.id
  })

  it('updates item status', async () => {
    const { POST } = await import('@/app/api/lists/route')
    const req = asRequest('POST', '/api/lists', {
      cookie: user.sessionCookie,
      body: {
        action: 'update_item',
        item_id: itemId,
        status: 'in_progress',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  it('deletes an item', async () => {
    const { POST } = await import('@/app/api/lists/route')
    const req = asRequest('POST', '/api/lists', {
      cookie: user.sessionCookie,
      body: {
        action: 'delete_item',
        item_id: itemId,
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})
