/**
 * Integration tests for /api/messages and related sub-routes
 *
 * Tests:
 *   - GET /api/messages — list messages in a channel
 *   - GET /api/messages/search — search messages
 *   - GET /api/messages/permalink — get message permalink
 *   - Auth guard (401 without session)
 *   - Channel parameter validation
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, createTestChannel, asRequest,
  expectSuccess, expectError, cleanupTestData,
  TestContext, TestUser
} from '../helpers'

let ctx: TestContext
let admin: TestUser
let plainMember: TestUser
const createdIds: string[] = []

// Helper: create channel with specific posting_mode (or archived state)
async function makeChannelWithMode(
  pool: typeof ctx.pool,
  creatorId: string,
  workspaceId: string,
  opts: {
    posting_mode?: 'everyone' | 'admins_only' | 'approved'
    archived?: boolean
  } = {}
): Promise<string> {
  const id = randomUUID()
  const now = Date.now()
  await pool.query(
    `INSERT INTO aaelink.channels
       (id, workspace_id, name, display_name, type, posting_mode, created_by, created_at,
        archived_at, is_archived)
     VALUES ($1, $2, $3, $3, 'O', $4, $5, $6, $7, $8)`,
    [
      id, workspaceId, `ch-${id.slice(0, 8)}`,
      opts.posting_mode ?? 'everyone',
      creatorId, now,
      opts.archived ? now : 0,
      opts.archived ? true : false,
    ]
  )
  // add creator as channel admin
  await pool.query(
    `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
     VALUES ($1, $2, 'admin', $3) ON CONFLICT DO NOTHING`,
    [id, creatorId, now]
  )
  return id
}

// Resolve test workspace id
let testWsId: string

beforeAll(async () => {
  ctx = await createTestContext()
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  plainMember = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(admin.id, plainMember.id)

  const { rows } = await ctx.pool.query(
    `SELECT id FROM aaelink.workspaces ORDER BY created_at LIMIT 1`
  )
  testWsId = rows[0].id
})

afterAll(async () => {
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('GET /api/messages', () => {
  it('returns 401 without session', async () => {
    const { GET } = await import('@/app/api/messages/route')
    const req = asRequest('GET', '/api/messages')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('requires channel_id parameter', async () => {
    const { GET } = await import('@/app/api/messages/route')
    const req = asRequest('GET', '/api/messages', { cookie: admin.sessionCookie })
    const res = await GET(req)
    expect([400, 404]).toContain(res.status)
  })

  it('returns messages for a valid channel', async () => {
    const { GET } = await import('@/app/api/messages/route')
    const channel = await createTestChannel(ctx.pool, admin.id)

    const req = asRequest('GET', '/api/messages', {
      cookie: admin.sessionCookie,
      query: { channel_id: channel.id }
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ posts: unknown[] }>(res)
    expect(Array.isArray(body.posts)).toBe(true)
  })
})

describe('GET /api/messages/search', () => {
  it('returns 401 without session', async () => {
    const { GET } = await import('@/app/api/messages/search/route')
    const req = asRequest('GET', '/api/messages/search')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('requires search query', async () => {
    const { GET } = await import('@/app/api/messages/search/route')
    const req = asRequest('GET', '/api/messages/search', {
      cookie: admin.sessionCookie,
    })
    const res = await GET(req)
    expect([200, 400]).toContain(res.status)
  })
})

describe('GET /api/messages/permalink', () => {
  it('returns 401 without session', async () => {
    const { GET } = await import('@/app/api/messages/permalink/route')
    const req = asRequest('GET', '/api/messages/permalink')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('non-member fetching a private-channel message permalink gets 403', async () => {
    const { GET } = await import('@/app/api/messages/permalink/route')

    // Create a private channel owned by admin
    const privateChannel = await createTestChannel(ctx.pool, admin.id, { type: 'private' })
    createdIds.push() // channel cleanup handled by cleanupTestData via admin.id

    // Insert a message in the private channel
    const messageId = randomUUID()
    const now = Date.now()
    await ctx.pool.query(
      `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, '', $5, $5)`,
      [messageId, privateChannel.id, admin.id, 'secret message', now]
    )

    // plainMember is a workspace member but NOT a member of the private channel
    await ctx.pool.query(
      `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
      [testWsId, plainMember.id]
    )

    const req = asRequest('GET', '/api/messages/permalink', {
      cookie: plainMember.sessionCookie,
      query: { message_id: messageId },
    })
    const res = await GET(req)
    await expectError(res, 403, 'forbidden')

    // Cleanup
    await ctx.pool.query(`DELETE FROM aaelink.messages WHERE id = $1`, [messageId])
    await ctx.pool.query(`DELETE FROM aaelink.channel_members WHERE channel_id = $1`, [privateChannel.id])
    await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = $1`, [privateChannel.id])
  })

  it('channel member fetching a private-channel message permalink succeeds', async () => {
    const { GET } = await import('@/app/api/messages/permalink/route')

    // Create a private channel owned by admin
    const privateChannel = await createTestChannel(ctx.pool, admin.id, { type: 'private' })

    // Insert a message in the private channel
    const messageId = randomUUID()
    const now = Date.now()
    await ctx.pool.query(
      `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, '', $5, $5)`,
      [messageId, privateChannel.id, admin.id, 'member-visible message', now]
    )

    // Ensure admin is a workspace member (createTestChannel already does this, but be explicit)
    await ctx.pool.query(
      `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`,
      [testWsId, admin.id]
    )

    const req = asRequest('GET', '/api/messages/permalink', {
      cookie: admin.sessionCookie,
      query: { message_id: messageId },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ permalink: string; channel_id: string; message_id: string }>(res)
    expect(body.message_id).toBe(messageId)
    expect(body.channel_id).toBe(privateChannel.id)
    expect(typeof body.permalink).toBe('string')

    // Cleanup
    await ctx.pool.query(`DELETE FROM aaelink.messages WHERE id = $1`, [messageId])
    await ctx.pool.query(`DELETE FROM aaelink.channel_members WHERE channel_id = $1`, [privateChannel.id])
    await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = $1`, [privateChannel.id])
  })
})

describe('bearer token tenant binding (grant.workspace_id)', () => {
  // Insert an oauth_token row scoped to a specific workspace; return raw token.
  async function mkToken(scope: string, workspaceId: string): Promise<string> {
    const tid = randomUUID()
    const token = `aaelink_oat_${randomUUID().replace(/-/g, '')}`
    await ctx.pool.query(
      `INSERT INTO aaelink.oauth_tokens
         (id, token, token_type, app_id, user_id, workspace_id, scope, expires_at, created_at)
       VALUES ($1, $2, 'bot', 'test-app', $3, $4, $5, 0, $6)`,
      [tid, token, admin.id, workspaceId, scope, Date.now()]
    )
    tokenIds.push(tid)
    return token
  }

  const tokenIds: string[] = []
  let wsA: string
  let wsB: string
  let channelInB: string

  beforeAll(async () => {
    // wsA = the system workspace the token will be scoped to.
    wsA = testWsId
    // wsB = a distinct workspace; admin is a member so per-channel ACL passes and
    // the ONLY thing that can block is the tenant-binding guard.
    wsB = randomUUID()
    await ctx.pool.query(
      `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system)
       VALUES ($1, $2, $2, $3, $4, false)`,
      [wsB, `ws-b-${wsB.slice(0, 8)}`, admin.id, Date.now()]
    )
    await ctx.pool.query(
      `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`,
      [wsB, admin.id]
    )
    channelInB = await makeChannelWithMode(ctx.pool, admin.id, wsB, {})
  })

  afterAll(async () => {
    if (tokenIds.length) {
      await ctx.pool.query(`DELETE FROM aaelink.oauth_tokens WHERE id = ANY($1)`, [tokenIds])
    }
    await ctx.pool.query(`DELETE FROM aaelink.messages WHERE channel_id = $1`, [channelInB])
    await ctx.pool.query(`DELETE FROM aaelink.channel_members WHERE channel_id = $1`, [channelInB])
    await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = $1`, [channelInB])
    await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE workspace_id = $1`, [wsB])
    await ctx.pool.query(`DELETE FROM aaelink.channels WHERE workspace_id = $1`, [wsB])
    await ctx.pool.query(`DELETE FROM aaelink.workspaces WHERE id = $1`, [wsB])
  })

  it('POST: token scoped to workspace A posting to a channel in workspace B → 403', async () => {
    const { POST } = await import('@/app/api/messages/route')
    const token = await mkToken('chat:write', wsA)

    const req = asRequest('POST', '/api/messages', {
      headers: { authorization: `Bearer ${token}` },
      body: { channel_id: channelInB, message: 'cross-tenant post' },
      noAutoCsrf: true,
    })
    const res = await POST(req as import('next/server').NextRequest)
    await expectError(res, 403, 'forbidden')
  })

  it('GET: token scoped to workspace A reading a channel in workspace B → 403', async () => {
    const { GET } = await import('@/app/api/messages/route')
    const token = await mkToken('chat:read', wsA)

    const req = asRequest('GET', '/api/messages', {
      headers: { authorization: `Bearer ${token}` },
      query: { channel_id: channelInB },
    })
    const res = await GET(req)
    await expectError(res, 403, 'forbidden')
  })

  it('POST: token scoped to the same workspace as the channel → succeeds', async () => {
    const { POST } = await import('@/app/api/messages/route')
    const channelInB2 = await makeChannelWithMode(ctx.pool, admin.id, wsB, {})
    const token = await mkToken('chat:write', wsB)

    const req = asRequest('POST', '/api/messages', {
      headers: { authorization: `Bearer ${token}` },
      body: { channel_id: channelInB2, message: 'same-tenant post' },
      noAutoCsrf: true,
    })
    const res = await POST(req as import('next/server').NextRequest)
    expect(res.status, `Expected 200 but got ${res.status}: ${await res.clone().text()}`).toBe(200)

    await ctx.pool.query(`DELETE FROM aaelink.messages WHERE channel_id = $1`, [channelInB2])
    await ctx.pool.query(`DELETE FROM aaelink.channel_members WHERE channel_id = $1`, [channelInB2])
    await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = $1`, [channelInB2])
  })

  it('GET: token scoped to the same workspace as the channel → succeeds', async () => {
    const { GET } = await import('@/app/api/messages/route')
    const token = await mkToken('chat:read', wsB)

    const req = asRequest('GET', '/api/messages', {
      headers: { authorization: `Bearer ${token}` },
      query: { channel_id: channelInB },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
  })
})

describe('POST /api/messages — posting_mode enforcement', () => {
  it('plain member blocked from admins_only channel → 403 forbidden_read_only_channel', async () => {
    const { POST } = await import('@/app/api/messages/route')

    const channelId = await makeChannelWithMode(ctx.pool, admin.id, testWsId, {
      posting_mode: 'admins_only',
    })
    // Ensure plainMember is a workspace member (for userCanReadChannel) but only a plain channel member
    await ctx.pool.query(
      `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
      [testWsId, plainMember.id]
    )
    await ctx.pool.query(
      `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
       VALUES ($1, $2, 'member', $3) ON CONFLICT DO NOTHING`,
      [channelId, plainMember.id, Date.now()]
    )

    const req = asRequest('POST', '/api/messages', {
      cookie: plainMember.sessionCookie,
      body: { channel_id: channelId, message: 'hello' },
    })
    const res = await POST(req as import('next/server').NextRequest)
    await expectError(res, 403, 'forbidden_read_only_channel')
  })

  it('POST to archived channel → 403 channel_archived', async () => {
    const { POST } = await import('@/app/api/messages/route')

    const channelId = await makeChannelWithMode(ctx.pool, admin.id, testWsId, {
      archived: true,
    })
    await ctx.pool.query(
      `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`,
      [testWsId, admin.id]
    )

    const req = asRequest('POST', '/api/messages', {
      cookie: admin.sessionCookie,
      body: { channel_id: channelId, message: 'hello' },
    })
    const res = await POST(req as import('next/server').NextRequest)
    await expectError(res, 403, 'channel_archived')
  })
})
