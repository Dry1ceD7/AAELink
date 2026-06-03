/**
 * Integration tests for /api/saved-searches
 *
 * Covers:
 *   - GET    list (current user, workspace scoped)
 *   - POST   create
 *   - PATCH  rename/update (owner only)
 *   - DELETE remove (owner only)
 *   - Auth guard (401 without session)
 *   - Input validation
 *   - Owner-only mutation isolation between users
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext, createTestUser, asRequest,
  expectSuccess, expectError, cleanupTestData, ensureSystemWorkspace,
  TestContext, TestUser
} from '../helpers'

let ctx: TestContext
let owner: TestUser
let other: TestUser
let workspaceId: string
const createdIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()
  owner = await createTestUser(ctx.pool)
  other = await createTestUser(ctx.pool)
  createdIds.push(owner.id, other.id)
  workspaceId = await ensureSystemWorkspace(ctx.pool)
})

afterAll(async () => {
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

async function create(user: TestUser, body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/saved-searches/route')
  return POST(asRequest('POST', '/api/saved-searches', { cookie: user.sessionCookie, body }))
}

describe('POST /api/saved-searches', () => {
  it('returns 401 without session', async () => {
    const { POST } = await import('@/app/api/saved-searches/route')
    const res = await POST(asRequest('POST', '/api/saved-searches', {
      body: { workspace_id: workspaceId, name: 'x', query: 'y' }
    }))
    expect(res.status).toBe(401)
  })

  it('rejects missing fields', async () => {
    const res = await create(owner, { workspace_id: workspaceId, name: 'no query' })
    await expectError(res, 400, 'invalid_input')
  })

  it('creates a saved search', async () => {
    const res = await create(owner, {
      workspace_id: workspaceId, name: 'From Alice', query: 'from:@alice', filters: { has: 'file' }
    })
    expect(res.status).toBe(201)
    const body = await expectSuccess<{ saved_search: { id: string; name: string; query: string; filters: Record<string, unknown> } }>(res)
    expect(body.saved_search.id).toBeTruthy()
    expect(body.saved_search.name).toBe('From Alice')
    expect(body.saved_search.query).toBe('from:@alice')
    expect(body.saved_search.filters).toEqual({ has: 'file' })
  })

  it('defaults filters to {} when omitted', async () => {
    const res = await create(owner, { workspace_id: workspaceId, name: 'Plain', query: 'hello' })
    const body = await expectSuccess<{ saved_search: { filters: Record<string, unknown> } }>(res)
    expect(body.saved_search.filters).toEqual({})
  })
})

describe('GET /api/saved-searches', () => {
  it('returns 401 without session', async () => {
    const { GET } = await import('@/app/api/saved-searches/route')
    const res = await GET(asRequest('GET', '/api/saved-searches', { query: { workspace_id: workspaceId } }))
    expect(res.status).toBe(401)
  })

  it('requires workspace_id', async () => {
    const { GET } = await import('@/app/api/saved-searches/route')
    const res = await GET(asRequest('GET', '/api/saved-searches', { cookie: owner.sessionCookie }))
    await expectError(res, 400, 'workspace_id_required')
  })

  it('lists only the current user saved searches', async () => {
    await create(other, { workspace_id: workspaceId, name: 'Other secret', query: 'mine' })
    const { GET } = await import('@/app/api/saved-searches/route')
    const res = await GET(asRequest('GET', '/api/saved-searches', {
      cookie: owner.sessionCookie, query: { workspace_id: workspaceId }
    }))
    const body = await expectSuccess<{ saved_searches: { name: string }[] }>(res)
    expect(Array.isArray(body.saved_searches)).toBe(true)
    expect(body.saved_searches.some(s => s.name === 'From Alice')).toBe(true)
    expect(body.saved_searches.some(s => s.name === 'Other secret')).toBe(false)
  })
})

describe('PATCH /api/saved-searches', () => {
  it('renames an owned saved search', async () => {
    const created = await expectSuccess<{ saved_search: { id: string } }>(
      await create(owner, { workspace_id: workspaceId, name: 'Old', query: 'q' })
    )
    const { PATCH } = await import('@/app/api/saved-searches/route')
    const res = await PATCH(asRequest('PATCH', '/api/saved-searches', {
      cookie: owner.sessionCookie, body: { id: created.saved_search.id, name: 'New' }
    }))
    const body = await expectSuccess<{ saved_search: { name: string } }>(res)
    expect(body.saved_search.name).toBe('New')
  })

  it('cannot update another user saved search (404)', async () => {
    const created = await expectSuccess<{ saved_search: { id: string } }>(
      await create(owner, { workspace_id: workspaceId, name: 'Owned', query: 'q' })
    )
    const { PATCH } = await import('@/app/api/saved-searches/route')
    const res = await PATCH(asRequest('PATCH', '/api/saved-searches', {
      cookie: other.sessionCookie, body: { id: created.saved_search.id, name: 'Hijacked' }
    }))
    await expectError(res, 404, 'not_found')
  })
})

describe('DELETE /api/saved-searches', () => {
  it('cannot delete another user saved search (404)', async () => {
    const created = await expectSuccess<{ saved_search: { id: string } }>(
      await create(owner, { workspace_id: workspaceId, name: 'Protected', query: 'q' })
    )
    const { DELETE } = await import('@/app/api/saved-searches/route')
    const res = await DELETE(asRequest('DELETE', '/api/saved-searches', {
      cookie: other.sessionCookie, body: { id: created.saved_search.id }
    }))
    await expectError(res, 404, 'not_found')
  })

  it('deletes an owned saved search', async () => {
    const created = await expectSuccess<{ saved_search: { id: string } }>(
      await create(owner, { workspace_id: workspaceId, name: 'ToDelete', query: 'q' })
    )
    const { DELETE } = await import('@/app/api/saved-searches/route')
    const res = await DELETE(asRequest('DELETE', '/api/saved-searches', {
      cookie: owner.sessionCookie, body: { id: created.saved_search.id }
    }))
    const body = await expectSuccess<{ ok: boolean; deleted: string }>(res)
    expect(body.ok).toBe(true)
    expect(body.deleted).toBe(created.saved_search.id)
  })
})
