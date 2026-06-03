/**
 * Integration tests for /api/lists
 *
 * Tests:
 *   - GET  — list all lists (returns { lists })
 *   - POST — create a list (action: 'create_list', returns { list })
 *   - POST — add an item to a list (action: 'add_item', requires list_id)
 *   - POST — update an item (action: 'update_item', requires item_id + values)
 *   - POST — delete an item (action: 'delete_item', requires item_id)
 *   - Auth guard
 *
 * Note: The lists route manages structured "Lists" (Slack Lists parity),
 *       not simple task items. Items are rows in a list, keyed by list_id.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext, createTestUser, asRequest,
  expectSuccess, cleanupTestData,
  TestContext, TestUser
} from '../helpers'

let ctx: TestContext
let user: TestUser
const createdIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
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

  it('returns lists array', async () => {
    const { GET } = await import('@/app/api/lists/route')
    const req = asRequest('GET', '/api/lists', { cookie: user.sessionCookie })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ lists: unknown[] }>(res)
    expect(body).toHaveProperty('lists')
    expect(Array.isArray(body.lists)).toBe(true)
  })
})

describe('POST /api/lists', () => {
  let listId: string
  let itemId: string

  it('creates a list (action: create_list)', async () => {
    const { POST } = await import('@/app/api/lists/route')
    const req = asRequest('POST', '/api/lists', {
      cookie: user.sessionCookie,
      body: {
        action: 'create_list',
        name: 'Test Task List',
      },
    })
    const res = await POST(req)
    expect([200, 201]).toContain(res.status)
    const body = await expectSuccess<{ list: { id: string } }>(res)
    expect(body.list).toHaveProperty('id')
    listId = body.list.id
  })

  it('adds a list item (action: add_item, requires list_id)', async () => {
    const { POST } = await import('@/app/api/lists/route')
    const req = asRequest('POST', '/api/lists', {
      cookie: user.sessionCookie,
      body: {
        action: 'add_item',
        list_id: listId,
        values: { Title: 'Test Task Alpha', Status: 'To Do', Priority: 'High' },
      },
    })
    const res = await POST(req)
    expect([200, 201]).toContain(res.status)
    const body = await expectSuccess<{ item: { id: string } }>(res)
    expect(body.item).toHaveProperty('id')
    itemId = body.item.id
  })

  it('updates item values (action: update_item)', async () => {
    const { POST } = await import('@/app/api/lists/route')
    const req = asRequest('POST', '/api/lists', {
      cookie: user.sessionCookie,
      body: {
        action: 'update_item',
        item_id: itemId,
        values: { Status: 'In Progress' },
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  it('deletes an item (action: delete_item)', async () => {
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
