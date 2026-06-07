/**
 * Integration tests for GET /api/search/channels
 *
 * Tests:
 *   - 401 without session
 *   - 400 without workspace_id
 *   - 403 for non-member of workspace
 *   - Returns public channels matching q
 *   - Excludes archived / private-non-member channels
 *   - joined flag correct for caller
 *   - member_count correct
 *   - Returns { channels, total }
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, asRequest,
  expectSuccess, expectError, cleanupTestData,
  TestContext, TestUser
} from '../helpers'

let ctx: TestContext
let member: TestUser
let nonMember: TestUser
let workspaceId: string
const cleanupIds: string[] = []
const channelIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()
  member = await createTestUser(ctx.pool, { role: 'employee' })
  nonMember = await createTestUser(ctx.pool, { role: 'employee' })
  cleanupIds.push(member.id, nonMember.id)

  workspaceId = randomUUID()
  const now = Date.now()

  await ctx.pool.query(
    `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system)
     VALUES ($1, $2, $3, $4, $5, false)`,
    [workspaceId, `search-int-ws-${workspaceId.slice(0, 6)}`, 'Search Int WS', member.id, now]
  )
  await ctx.pool.query(
    `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
    [workspaceId, member.id]
  )

  // Public channel — not joined by member
  const chPublicId = randomUUID()
  channelIds.push(chPublicId)
  await ctx.pool.query(
    `INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, created_at, archived_at, purpose)
     VALUES ($1, $2, 'search-public', 'Search Public', 'O', $3, 0, 'A great public channel')`,
    [chPublicId, workspaceId, now]
  )

  // Public channel — joined by member
  const chJoinedId = randomUUID()
  channelIds.push(chJoinedId)
  await ctx.pool.query(
    `INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, created_at, archived_at)
     VALUES ($1, $2, 'search-joined', 'Search Joined', 'O', $3, 0)`,
    [chJoinedId, workspaceId, now]
  )
  await ctx.pool.query(
    `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at) VALUES ($1, $2, 'member', $3)`,
    [chJoinedId, member.id, now]
  )

  // Private channel — not joined by member → should be excluded
  const chPrivateId = randomUUID()
  channelIds.push(chPrivateId)
  await ctx.pool.query(
    `INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, created_at, archived_at)
     VALUES ($1, $2, 'search-private', 'Search Private', 'P', $3, 0)`,
    [chPrivateId, workspaceId, now]
  )

  // Archived channel — should be excluded
  const chArchivedId = randomUUID()
  channelIds.push(chArchivedId)
  await ctx.pool.query(
    `INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, created_at, archived_at)
     VALUES ($1, $2, 'search-archived', 'Search Archived', 'O', $3, $4)`,
    [chArchivedId, workspaceId, now, now - 1000]
  )
})

afterAll(async () => {
  if (channelIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.channel_members WHERE channel_id = ANY($1::text[])`, [channelIds])
    await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = ANY($1::text[])`, [channelIds])
  }
  if (workspaceId) {
    await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE workspace_id = $1`, [workspaceId])
    await ctx.pool.query(`DELETE FROM aaelink.workspaces WHERE id = $1`, [workspaceId])
  }
  await cleanupTestData(ctx.pool, cleanupIds)
  await ctx.cleanup()
})

describe('GET /api/search/channels', () => {
  it('returns 401 without session', async () => {
    const { GET } = await import('@/app/api/search/channels/route')
    const req = asRequest('GET', '/api/search/channels')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 when workspace_id is missing', async () => {
    const { GET } = await import('@/app/api/search/channels/route')
    const req = asRequest('GET', '/api/search/channels', { cookie: member.sessionCookie })
    const res = await GET(req)
    await expectError(res, 400, 'workspace_id_required')
  })

  it('returns 403 for non-member of workspace', async () => {
    const { GET } = await import('@/app/api/search/channels/route')
    const req = asRequest('GET', '/api/search/channels', {
      cookie: nonMember.sessionCookie,
      query: { workspace_id: workspaceId },
    })
    const res = await GET(req)
    await expectError(res, 403, 'forbidden')
  })

  it('returns { channels, total } shape', async () => {
    const { GET } = await import('@/app/api/search/channels/route')
    const req = asRequest('GET', '/api/search/channels', {
      cookie: member.sessionCookie,
      query: { workspace_id: workspaceId },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ channels: unknown[]; total: number }>(res)
    expect(Array.isArray(body.channels)).toBe(true)
    expect(typeof body.total).toBe('number')
  })

  it('returns public channels', async () => {
    const { GET } = await import('@/app/api/search/channels/route')
    const req = asRequest('GET', '/api/search/channels', {
      cookie: member.sessionCookie,
      query: { workspace_id: workspaceId },
    })
    const res = await GET(req)
    const body = await expectSuccess<{ channels: { id: string }[] }>(res)
    const ids = body.channels.map(c => c.id)
    expect(ids).toContain(channelIds[0]) // chPublicId
    expect(ids).toContain(channelIds[1]) // chJoinedId
  })

  it('excludes private channels the caller has not joined', async () => {
    const { GET } = await import('@/app/api/search/channels/route')
    const req = asRequest('GET', '/api/search/channels', {
      cookie: member.sessionCookie,
      query: { workspace_id: workspaceId },
    })
    const res = await GET(req)
    const body = await expectSuccess<{ channels: { id: string }[] }>(res)
    const ids = body.channels.map(c => c.id)
    expect(ids).not.toContain(channelIds[2]) // chPrivateId
  })

  it('excludes archived channels', async () => {
    const { GET } = await import('@/app/api/search/channels/route')
    const req = asRequest('GET', '/api/search/channels', {
      cookie: member.sessionCookie,
      query: { workspace_id: workspaceId },
    })
    const res = await GET(req)
    const body = await expectSuccess<{ channels: { id: string }[] }>(res)
    const ids = body.channels.map(c => c.id)
    expect(ids).not.toContain(channelIds[3]) // chArchivedId
  })

  it('filters by q param', async () => {
    const { GET } = await import('@/app/api/search/channels/route')
    const req = asRequest('GET', '/api/search/channels', {
      cookie: member.sessionCookie,
      query: { workspace_id: workspaceId, q: 'great public' },
    })
    const res = await GET(req)
    const body = await expectSuccess<{ channels: { id: string }[] }>(res)
    const ids = body.channels.map(c => c.id)
    expect(ids).toContain(channelIds[0]) // matched by purpose
  })

  it('returns no results for unmatched q', async () => {
    const { GET } = await import('@/app/api/search/channels/route')
    const req = asRequest('GET', '/api/search/channels', {
      cookie: member.sessionCookie,
      query: { workspace_id: workspaceId, q: 'zzzzzzzno-match-xyz' },
    })
    const res = await GET(req)
    const body = await expectSuccess<{ channels: unknown[]; total: number }>(res)
    expect(body.channels).toHaveLength(0)
    expect(body.total).toBe(0)
  })

  it('sets joined=true for channels the caller has joined', async () => {
    const { GET } = await import('@/app/api/search/channels/route')
    const req = asRequest('GET', '/api/search/channels', {
      cookie: member.sessionCookie,
      query: { workspace_id: workspaceId, q: 'search-joined' },
    })
    const res = await GET(req)
    const body = await expectSuccess<{ channels: { id: string; joined: boolean }[] }>(res)
    const ch = body.channels.find(c => c.id === channelIds[1])
    expect(ch?.joined).toBe(true)
  })

  it('sets joined=false for channels the caller has not joined', async () => {
    const { GET } = await import('@/app/api/search/channels/route')
    const req = asRequest('GET', '/api/search/channels', {
      cookie: member.sessionCookie,
      query: { workspace_id: workspaceId, q: 'search-public' },
    })
    const res = await GET(req)
    const body = await expectSuccess<{ channels: { id: string; joined: boolean }[] }>(res)
    const ch = body.channels.find(c => c.id === channelIds[0])
    expect(ch?.joined).toBe(false)
  })

  it('returns member_count in each channel', async () => {
    const { GET } = await import('@/app/api/search/channels/route')
    const req = asRequest('GET', '/api/search/channels', {
      cookie: member.sessionCookie,
      query: { workspace_id: workspaceId, q: 'search-joined' },
    })
    const res = await GET(req)
    const body = await expectSuccess<{ channels: { id: string; member_count: number }[] }>(res)
    const ch = body.channels.find(c => c.id === channelIds[1])
    expect(typeof ch?.member_count).toBe('number')
    expect(ch!.member_count).toBeGreaterThanOrEqual(1)
  })
})
