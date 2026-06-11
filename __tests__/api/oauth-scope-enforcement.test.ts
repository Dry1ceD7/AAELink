/**
 * Integration tests — OAuth scope enforcement on bearer-token API surface.
 *
 * Verifies the enforceScope() gate wired into:
 *   POST /api/messages  — chat:write
 *   GET  /api/messages  — chat:read
 *   GET  /api/channels  — channels:read
 *   GET  /api/users/directory — users:read
 *   GET  /api/files     — files:read
 *
 * Test matrix per relevant route:
 *   1. Valid token + required scope → succeeds (uses token user_id, no session)
 *   2. Valid token + wrong scope    → 403 insufficient_scope
 *   3. Expired token                → 401 token_expired
 *   4. No Authorization header      → falls through to session path (unchanged)
 *   5. Bot token (xbot-*)           → honoured on chat:write
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, createTestChannel,
  asRequest, parseResponse,
  TestContext, TestUser,
} from '../helpers'

let ctx: TestContext
let user: TestUser
// The workspace test channels live in (createTestChannel picks the oldest = system).
let systemWsId: string

// IDs accumulated for cleanup
const tokenIds: string[] = []
const botIds: string[] = []
const userIds: string[] = []
const channelIds: string[] = []

/** Insert an oauth_token row and return the raw token string. */
async function mkToken(opts: {
  scope: string
  expiresAt?: number
  userId?: string
  /** Token-scoped workspace. Empty string = unscoped (no tenant binding). */
  workspaceId?: string
}): Promise<string> {
  const id = randomUUID()
  const token = `aaelink_oat_${randomUUID().replace(/-/g, '')}`
  // Default to the user's actual workspace so the token is correctly tenant-bound
  // to the workspace its channels live in (matches real OAuth grant minting).
  const wsId = opts.workspaceId ?? systemWsId
  await ctx.pool.query(
    `INSERT INTO aaelink.oauth_tokens
       (id, token, token_type, app_id, user_id, workspace_id, scope, expires_at, created_at)
     VALUES ($1, $2, 'bot', 'test-app', $3, $4, $5, $6, $7)`,
    [id, token, opts.userId ?? user.id, wsId, opts.scope, opts.expiresAt ?? 0, Date.now()]
  )
  tokenIds.push(id)
  return token
}

/** Insert a bot_users row and return its xbot-* api_token. */
async function mkBotToken(opts: { scopes: string[] }): Promise<string> {
  const id = randomUUID()
  const token = `xbot-${randomUUID().replace(/-/g, '')}`
  await ctx.pool.query(
    `INSERT INTO aaelink.bot_users
       (id, kind, name, description, scopes, status, api_token, created_by, created_at)
     VALUES ($1, 'bot', $2, '', $3, 'active', $4, $5, $6)`,
    [id, `test-bot-${id.slice(0, 8)}`, JSON.stringify(opts.scopes), token, user.id, Date.now()]
  )
  botIds.push(id)
  return token
}

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(user.id)
  const { rows } = await ctx.pool.query<{ id: string }>(
    `SELECT id FROM aaelink.workspaces ORDER BY created_at LIMIT 1`
  )
  systemWsId = rows[0].id
})

afterAll(async () => {
  if (tokenIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.oauth_tokens WHERE id = ANY($1)`, [tokenIds])
  }
  if (botIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.bot_users WHERE id = ANY($1)`, [botIds])
  }
  if (channelIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.channel_members WHERE channel_id = ANY($1)`, [channelIds])
    await ctx.pool.query(`DELETE FROM aaelink.messages WHERE channel_id = ANY($1)`, [channelIds])
    await ctx.pool.query(`DELETE FROM aaelink.channel_read_state WHERE channel_id = ANY($1)`, [channelIds])
    await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = ANY($1)`, [channelIds])
  }
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

// ── POST /api/messages (chat:write) ────────────────────────────────────────

describe('POST /api/messages — chat:write scope', () => {
  it('valid token with chat:write posts a message (200)', async () => {
    const { POST } = await import('@/app/api/messages/route')
    const channel = await createTestChannel(ctx.pool, user.id)
    channelIds.push(channel.id)
    const token = await mkToken({ scope: 'chat:write', userId: user.id })

    const req = asRequest('POST', '/api/messages', {
      headers: { authorization: `Bearer ${token}` },
      body: { channel_id: channel.id, message: 'hello from token' },
      noAutoCsrf: true,
    })
    const res = await POST(req)
    expect(res.status, `Expected 200 but got ${res.status}: ${await res.clone().text()}`).toBe(200)
  })

  it('valid token without chat:write → 403 insufficient_scope', async () => {
    const { POST } = await import('@/app/api/messages/route')
    const channel = await createTestChannel(ctx.pool, user.id)
    channelIds.push(channel.id)
    const token = await mkToken({ scope: 'chat:read' })

    const req = asRequest('POST', '/api/messages', {
      headers: { authorization: `Bearer ${token}` },
      body: { channel_id: channel.id, message: 'should be blocked' },
      noAutoCsrf: true,
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
    const body = await parseResponse(res)
    expect(body.error).toBe('insufficient_scope')
  })

  it('expired token → 401 token_expired', async () => {
    const { POST } = await import('@/app/api/messages/route')
    const channel = await createTestChannel(ctx.pool, user.id)
    channelIds.push(channel.id)
    const token = await mkToken({ scope: 'chat:write', expiresAt: Date.now() - 5000 })

    const req = asRequest('POST', '/api/messages', {
      headers: { authorization: `Bearer ${token}` },
      body: { channel_id: channel.id, message: 'expired' },
      noAutoCsrf: true,
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    const body = await parseResponse(res)
    expect(body.error).toBe('token_expired')
  })

  it('no Authorization header → session path still works (authenticated)', async () => {
    const { POST } = await import('@/app/api/messages/route')
    const channel = await createTestChannel(ctx.pool, user.id)
    channelIds.push(channel.id)

    const req = asRequest('POST', '/api/messages', {
      cookie: user.sessionCookie,
      body: { channel_id: channel.id, message: 'session auth' },
    })
    const res = await POST(req)
    // 200 = posted; anything other than a 401/403 caused by scope is fine
    expect([200, 201]).toContain(res.status)
  })

  it('no Authorization header + no session → 401 (session path unchanged)', async () => {
    const { POST } = await import('@/app/api/messages/route')
    const req = asRequest('POST', '/api/messages', {
      body: { channel_id: 'fake', message: 'test' },
      noAutoCsrf: true,
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('bot token (xbot-*) with chat:write → 200', async () => {
    const { POST } = await import('@/app/api/messages/route')
    const channel = await createTestChannel(ctx.pool, user.id)
    channelIds.push(channel.id)
    const token = await mkBotToken({ scopes: ['chat:write'] })

    const req = asRequest('POST', '/api/messages', {
      headers: { authorization: `Bearer ${token}` },
      body: { channel_id: channel.id, message: 'bot says hello' },
      noAutoCsrf: true,
    })
    const res = await POST(req)
    expect(res.status, `Expected 200 but got ${res.status}: ${await res.clone().text()}`).toBe(200)
  })

  it('bot token without required scope → 403 insufficient_scope', async () => {
    const { POST } = await import('@/app/api/messages/route')
    const channel = await createTestChannel(ctx.pool, user.id)
    channelIds.push(channel.id)
    const token = await mkBotToken({ scopes: ['channels:read'] })

    const req = asRequest('POST', '/api/messages', {
      headers: { authorization: `Bearer ${token}` },
      body: { channel_id: channel.id, message: 'bot blocked' },
      noAutoCsrf: true,
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
    const body = await parseResponse(res)
    expect(body.error).toBe('insufficient_scope')
  })
})

// ── GET /api/messages (chat:read) ──────────────────────────────────────────

describe('GET /api/messages — chat:read scope', () => {
  it('valid token with chat:read reads messages', async () => {
    const { GET } = await import('@/app/api/messages/route')
    const channel = await createTestChannel(ctx.pool, user.id)
    channelIds.push(channel.id)
    const token = await mkToken({ scope: 'chat:read', userId: user.id })

    const req = asRequest('GET', '/api/messages', {
      headers: { authorization: `Bearer ${token}` },
      query: { channel_id: channel.id },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
  })

  it('token with wrong scope → 403', async () => {
    const { GET } = await import('@/app/api/messages/route')
    const token = await mkToken({ scope: 'files:read' })

    const req = asRequest('GET', '/api/messages', {
      headers: { authorization: `Bearer ${token}` },
      query: { channel_id: 'irrelevant' },
    })
    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  it('expired token → 401', async () => {
    const { GET } = await import('@/app/api/messages/route')
    const token = await mkToken({ scope: 'chat:read', expiresAt: Date.now() - 1 })

    const req = asRequest('GET', '/api/messages', {
      headers: { authorization: `Bearer ${token}` },
      query: { channel_id: 'irrelevant' },
    })
    const res = await GET(req)
    expect(res.status).toBe(401)
    const body = await parseResponse(res)
    expect(body.error).toBe('token_expired')
  })
})

// ── GET /api/channels (channels:read) ─────────────────────────────────────

describe('GET /api/channels — channels:read scope', () => {
  it('valid token with channels:read → 200', async () => {
    const { GET } = await import('@/app/api/channels/route')
    const token = await mkToken({ scope: 'channels:read', userId: user.id })

    // Get the workspace this user belongs to
    const { rows } = await ctx.pool.query<{ workspace_id: string }>(
      `SELECT workspace_id FROM aaelink.workspace_members WHERE user_id = $1 LIMIT 1`,
      [user.id]
    )
    const wsId = rows[0]?.workspace_id ?? 'ws-test'

    const req = asRequest('GET', '/api/channels', {
      headers: { authorization: `Bearer ${token}` },
      query: { workspace_id: wsId },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
  })

  it('token without channels:read → 403', async () => {
    const { GET } = await import('@/app/api/channels/route')
    const token = await mkToken({ scope: 'chat:write' })

    const req = asRequest('GET', '/api/channels', {
      headers: { authorization: `Bearer ${token}` },
      query: { workspace_id: 'ws-test' },
    })
    const res = await GET(req)
    expect(res.status).toBe(403)
    const body = await parseResponse(res)
    expect(body.error).toBe('insufficient_scope')
  })

  it('no token → session path (401 without session)', async () => {
    const { GET } = await import('@/app/api/channels/route')
    const req = asRequest('GET', '/api/channels', { query: { workspace_id: 'ws-test' } })
    const res = await GET(req)
    expect(res.status).toBe(401)
  })
})

// ── GET /api/users/directory (users:read) ─────────────────────────────────

describe('GET /api/users/directory — users:read scope', () => {
  it('valid token with users:read → 200', async () => {
    const { GET } = await import('@/app/api/users/directory/route')
    const token = await mkToken({ scope: 'users:read' })

    const req = asRequest('GET', '/api/users/directory', {
      headers: { authorization: `Bearer ${token}` },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
  })

  it('token without users:read → 403', async () => {
    const { GET } = await import('@/app/api/users/directory/route')
    const token = await mkToken({ scope: 'chat:write' })

    const req = asRequest('GET', '/api/users/directory', {
      headers: { authorization: `Bearer ${token}` },
    })
    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  it('no token → session path (401 without session)', async () => {
    const { GET } = await import('@/app/api/users/directory/route')
    const req = asRequest('GET', '/api/users/directory', {})
    const res = await GET(req)
    expect(res.status).toBe(401)
  })
})

// ── bearer token tenant binding — channels ────────────────────────────────

describe('bearer token tenant binding — GET /api/channels', () => {
  const tenantTokenIds: string[] = []
  let wsA: string
  let wsB: string
  let userInBothWorkspaces: import('../helpers').TestUser

  beforeAll(async () => {
    wsA = systemWsId
    wsB = randomUUID()
    await ctx.pool.query(
      `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system)
       VALUES ($1, $2, $2, $3, $4, false)`,
      [wsB, `ws-b-${wsB.slice(0, 8)}`, user.id, Date.now()]
    )
    userInBothWorkspaces = await createTestUser(ctx.pool, { role: 'employee' })
    userIds.push(userInBothWorkspaces.id)
    // Add the user to wsB as well so per-workspace member check passes.
    await ctx.pool.query(
      `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
      [wsB, userInBothWorkspaces.id]
    )
  })

  afterAll(async () => {
    if (tenantTokenIds.length) {
      await ctx.pool.query(`DELETE FROM aaelink.oauth_tokens WHERE id = ANY($1)`, [tenantTokenIds])
    }
    await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE workspace_id = $1`, [wsB])
    await ctx.pool.query(`DELETE FROM aaelink.workspaces WHERE id = $1`, [wsB])
  })

  async function mkTenantToken(scope: string, workspaceId: string, userId: string): Promise<string> {
    const id = randomUUID()
    const token = `aaelink_oat_${randomUUID().replace(/-/g, '')}`
    await ctx.pool.query(
      `INSERT INTO aaelink.oauth_tokens
         (id, token, token_type, app_id, user_id, workspace_id, scope, expires_at, created_at)
       VALUES ($1, $2, 'bot', 'test-app', $3, $4, $5, 0, $6)`,
      [id, token, userId, workspaceId, scope, Date.now()]
    )
    tenantTokenIds.push(id)
    return token
  }

  it('token scoped to workspace A requesting workspace_id=B → 403 even when user is member of B', async () => {
    const { GET } = await import('@/app/api/channels/route')
    // Token is scoped to wsA but we request channels from wsB.
    // The user is a member of wsB, so the ONLY guard is the tenant binding.
    const token = await mkTenantToken('channels:read', wsA, userInBothWorkspaces.id)

    const req = asRequest('GET', '/api/channels', {
      headers: { authorization: `Bearer ${token}` },
      query: { workspace_id: wsB },
    })
    const res = await GET(req)
    expect(res.status).toBe(403)
    const body = await parseResponse(res)
    expect(body.error).toBe('forbidden')
  })

  it('token scoped to workspace A requesting workspace_id=A → 200', async () => {
    const { GET } = await import('@/app/api/channels/route')
    const token = await mkTenantToken('channels:read', wsA, userInBothWorkspaces.id)

    const req = asRequest('GET', '/api/channels', {
      headers: { authorization: `Bearer ${token}` },
      query: { workspace_id: wsA },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
  })
})

// ── bearer token tenant binding — users/directory ─────────────────────────

describe('bearer token tenant binding — GET /api/users/directory', () => {
  const tenantDirTokenIds: string[] = []
  let wsA: string
  let wsB: string
  let userOnlyInB: import('../helpers').TestUser

  beforeAll(async () => {
    wsA = systemWsId
    wsB = randomUUID()
    await ctx.pool.query(
      `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system)
       VALUES ($1, $2, $2, $3, $4, false)`,
      [wsB, `ws-dir-b-${wsB.slice(0, 8)}`, user.id, Date.now()]
    )
    // Create a user that is ONLY in wsB, not in wsA.
    userOnlyInB = await createTestUser(ctx.pool, { role: 'employee' })
    userIds.push(userOnlyInB.id)
    // Remove from wsA (createTestUser adds to system workspace) and put in wsB only.
    await ctx.pool.query(
      `DELETE FROM aaelink.workspace_members WHERE user_id = $1 AND workspace_id = $2`,
      [userOnlyInB.id, wsA]
    )
    await ctx.pool.query(
      `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
      [wsB, userOnlyInB.id]
    )
  })

  afterAll(async () => {
    if (tenantDirTokenIds.length) {
      await ctx.pool.query(`DELETE FROM aaelink.oauth_tokens WHERE id = ANY($1)`, [tenantDirTokenIds])
    }
    await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE workspace_id = $1`, [wsB])
    await ctx.pool.query(`DELETE FROM aaelink.workspaces WHERE id = $1`, [wsB])
  })

  async function mkDirToken(workspaceId: string): Promise<string> {
    const id = randomUUID()
    const token = `aaelink_oat_${randomUUID().replace(/-/g, '')}`
    await ctx.pool.query(
      `INSERT INTO aaelink.oauth_tokens
         (id, token, token_type, app_id, user_id, workspace_id, scope, expires_at, created_at)
       VALUES ($1, $2, 'bot', 'test-app', $3, $4, 'users:read', 0, $5)`,
      [id, token, user.id, workspaceId, Date.now()]
    )
    tenantDirTokenIds.push(id)
    return token
  }

  it('token scoped to workspace A only returns members of A (user only in B is excluded)', async () => {
    const { GET } = await import('@/app/api/users/directory/route')
    const token = await mkDirToken(wsA)

    const req = asRequest('GET', '/api/users/directory', {
      headers: { authorization: `Bearer ${token}` },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await parseResponse(res)
    const ids: string[] = (body.members ?? []).map((m: { id: string }) => m.id)
    expect(ids).not.toContain(userOnlyInB.id)
  })

  it('session auth (no grant) still returns the global list including user only in B', async () => {
    const { GET } = await import('@/app/api/users/directory/route')

    const req = asRequest('GET', '/api/users/directory', {
      cookie: user.sessionCookie,
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await parseResponse(res)
    const ids: string[] = (body.members ?? []).map((m: { id: string }) => m.id)
    expect(ids).toContain(userOnlyInB.id)
  })
})

// ── GET /api/files (files:read) ────────────────────────────────────────────

describe('GET /api/files — files:read scope', () => {
  it('valid token with files:read → 200', async () => {
    const { GET } = await import('@/app/api/files/route')
    const token = await mkToken({ scope: 'files:read' })

    const req = asRequest('GET', '/api/files', {
      headers: { authorization: `Bearer ${token}` },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
  })

  it('token without files:read → 403', async () => {
    const { GET } = await import('@/app/api/files/route')
    const token = await mkToken({ scope: 'chat:write' })

    const req = asRequest('GET', '/api/files', {
      headers: { authorization: `Bearer ${token}` },
    })
    const res = await GET(req)
    expect(res.status).toBe(403)
    const body = await parseResponse(res)
    expect(body.error).toBe('insufficient_scope')
  })

  it('no token → session path (401 without session)', async () => {
    const { GET } = await import('@/app/api/files/route')
    const req = asRequest('GET', '/api/files', {})
    const res = await GET(req)
    expect(res.status).toBe(401)
  })
})
