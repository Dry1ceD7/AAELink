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
let other: TestUser
const createdIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  other = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(user.id, other.id)
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

  it('forbids a non-creator from reading another user\'s personal list', async () => {
    const { POST, GET } = await import('@/app/api/lists/route')
    const created = await POST(asRequest('POST', '/api/lists', {
      cookie: user.sessionCookie, body: { action: 'create_list', name: 'Private List' },
    }))
    const { list } = await expectSuccess<{ list: { id: string } }>(created)

    // creator can read it
    const ownRes = await GET(asRequest('GET', '/api/lists', { cookie: user.sessionCookie, query: { list_id: list.id } }))
    expect(ownRes.status).toBe(200)

    // a different user cannot
    const otherRes = await GET(asRequest('GET', '/api/lists', { cookie: other.sessionCookie, query: { list_id: list.id } }))
    expect(otherRes.status).toBe(403)
  })

  it('list-all returns only the caller\'s own lists, not everyone\'s', async () => {
    const { GET } = await import('@/app/api/lists/route')
    const res = await GET(asRequest('GET', '/api/lists', { cookie: other.sessionCookie }))
    const body = await expectSuccess<{ lists: Array<{ created_by: string }> }>(res)
    expect(body.lists.every(l => l.created_by === other.id)).toBe(true)
  })
})

describe('POST /api/lists — columns', () => {
  let listId: string
  let itemId: string

  it('sets up a list with a custom column and an item that uses it', async () => {
    const { POST } = await import('@/app/api/lists/route')
    const created = await POST(asRequest('POST', '/api/lists', {
      cookie: user.sessionCookie, body: { action: 'create_list', name: 'Columns List' },
    }))
    const { list } = await expectSuccess<{ list: { id: string } }>(created)
    listId = list.id

    await POST(asRequest('POST', '/api/lists', {
      cookie: user.sessionCookie,
      body: { action: 'add_column', list_id: listId, column_name: 'Priority', column_type: 'status', column_options: ['Low', 'High'] },
    }))

    const item = await POST(asRequest('POST', '/api/lists', {
      cookie: user.sessionCookie,
      body: { action: 'add_item', list_id: listId, values: { Title: 'Row', Priority: 'High' } },
    }))
    const { item: created2 } = await expectSuccess<{ item: { id: string } }>(item)
    itemId = created2.id
  })

  it('update_column renames the column and carries item values to the new key', async () => {
    const { POST, GET } = await import('@/app/api/lists/route')
    const res = await POST(asRequest('POST', '/api/lists', {
      cookie: user.sessionCookie,
      body: { action: 'update_column', list_id: listId, column_name: 'Priority', new_column_name: 'Urgency' },
    }))
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ columns: Array<{ name: string }> }>(res)
    expect(body.columns.some(c => c.name === 'Urgency')).toBe(true)
    expect(body.columns.some(c => c.name === 'Priority')).toBe(false)

    const got = await GET(asRequest('GET', '/api/lists', { cookie: user.sessionCookie, query: { list_id: listId } }))
    const read = await expectSuccess<{ list: { items: Array<{ id: string; values: Record<string, unknown> }> } }>(got)
    const row = read.list.items.find(i => i.id === itemId)!
    expect(row.values.Urgency).toBe('High')
    expect(row.values.Priority).toBeUndefined()
  })

  it('delete_column removes the column and strips its values from items', async () => {
    const { POST, GET } = await import('@/app/api/lists/route')
    const res = await POST(asRequest('POST', '/api/lists', {
      cookie: user.sessionCookie,
      body: { action: 'delete_column', list_id: listId, column_name: 'Urgency' },
    }))
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ columns: Array<{ name: string }> }>(res)
    expect(body.columns.some(c => c.name === 'Urgency')).toBe(false)

    const got = await GET(asRequest('GET', '/api/lists', { cookie: user.sessionCookie, query: { list_id: listId } }))
    const read = await expectSuccess<{ list: { items: Array<{ id: string; values: Record<string, unknown> }> } }>(got)
    const row = read.list.items.find(i => i.id === itemId)!
    expect(row.values.Urgency).toBeUndefined()
  })

  it('delete_column on a missing column returns 404', async () => {
    const { POST } = await import('@/app/api/lists/route')
    const res = await POST(asRequest('POST', '/api/lists', {
      cookie: user.sessionCookie,
      body: { action: 'delete_column', list_id: listId, column_name: 'Nope' },
    }))
    expect(res.status).toBe(404)
  })

  it('rejects a column op without a CSRF token', async () => {
    const { POST } = await import('@/app/api/lists/route')
    const req = asRequest('POST', '/api/lists', {
      cookie: user.sessionCookie,
      body: { action: 'add_column', list_id: listId, column_name: 'X', column_type: 'text' },
      noAutoCsrf: true,
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('forbids a non-creator from mutating columns', async () => {
    const { POST } = await import('@/app/api/lists/route')
    const res = await POST(asRequest('POST', '/api/lists', {
      cookie: other.sessionCookie,
      body: { action: 'add_column', list_id: listId, column_name: 'Y', column_type: 'text' },
    }))
    expect(res.status).toBe(403)
  })
})
