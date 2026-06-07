/**
 * Integration tests for /api/pins — channel-membership RBAC.
 *
 * Verifies that non-members cannot list, pin, or unpin messages in channels
 * they cannot read, and that members can perform all operations.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext,
  createTestUser,
  asRequest,
  TestContext,
  TestUser,
} from '../helpers'

let ctx: TestContext
let member: TestUser
let nonMember: TestUser

const wsIds: string[] = []
const chIds: string[] = []
const msgIds: string[] = []
const userIds: string[] = []

async function mkWorkspace(ownerId: string): Promise<string> {
  const id = `ws-${randomUUID().slice(0, 12)}`
  await ctx.pool.query(
    `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system)
     VALUES ($1, $1, $2, $3, $4, false)`,
    [id, `WS ${id.slice(-6)}`, ownerId, Date.now()]
  )
  wsIds.push(id)
  return id
}

async function mkPrivateChannel(wsId: string): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, created_at)
     VALUES ($1, $2, $3, $3, 'P', $4)`,
    [id, wsId, `priv-${id.slice(0, 8)}`, Date.now()]
  )
  chIds.push(id)
  return id
}

async function addChannelMember(chId: string, uid: string): Promise<void> {
  await ctx.pool.query(
    `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
     VALUES ($1, $2, 'member', $3) ON CONFLICT DO NOTHING`,
    [chId, uid, Date.now()]
  )
}

async function addWorkspaceMember(wsId: string, uid: string): Promise<void> {
  await ctx.pool.query(
    `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
    [wsId, uid]
  )
}

async function mkMessage(chId: string, uid: string): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
     VALUES ($1, $2, $3, 'test pin body', '', $4, $4)`,
    [id, chId, uid, Date.now()]
  )
  msgIds.push(id)
  return id
}

beforeAll(async () => {
  ctx = await createTestContext()
  member = await createTestUser(ctx.pool, { role: 'employee' })
  nonMember = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(member.id, nonMember.id)
})

afterAll(async () => {
  if (msgIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.pinned_messages WHERE message_id = ANY($1)`, [msgIds])
    await ctx.pool.query(`DELETE FROM aaelink.messages WHERE id = ANY($1)`, [msgIds])
  }
  if (chIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.channel_members WHERE channel_id = ANY($1)`, [chIds])
    await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = ANY($1)`, [chIds])
  }
  if (wsIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE workspace_id = ANY($1)`, [wsIds])
    await ctx.pool.query(`DELETE FROM aaelink.workspaces WHERE id = ANY($1)`, [wsIds])
  }
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('GET /api/pins — channel RBAC', () => {
  it('returns 403 for a non-member of a private channel', async () => {
    const { GET } = await import('@/app/api/pins/route')
    const ws = await mkWorkspace(member.id)
    await addWorkspaceMember(ws, member.id)
    await addWorkspaceMember(ws, nonMember.id)
    const ch = await mkPrivateChannel(ws)
    await addChannelMember(ch, member.id)
    // nonMember is a workspace member but NOT a channel member

    const req = asRequest('GET', '/api/pins', {
      cookie: nonMember.sessionCookie,
      query: { channel_id: ch },
    })
    const res = await GET(req)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('forbidden')
  })

  it('returns 200 with pins for a channel member', async () => {
    const { GET } = await import('@/app/api/pins/route')
    const ws = await mkWorkspace(member.id)
    await addWorkspaceMember(ws, member.id)
    const ch = await mkPrivateChannel(ws)
    await addChannelMember(ch, member.id)

    const req = asRequest('GET', '/api/pins', {
      cookie: member.sessionCookie,
      query: { channel_id: ch },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.pins)).toBe(true)
  })
})

describe('POST /api/pins — channel RBAC', () => {
  it('returns 403 when non-member tries to pin', async () => {
    const { POST } = await import('@/app/api/pins/route')
    const ws = await mkWorkspace(member.id)
    await addWorkspaceMember(ws, member.id)
    await addWorkspaceMember(ws, nonMember.id)
    const ch = await mkPrivateChannel(ws)
    await addChannelMember(ch, member.id)
    const msg = await mkMessage(ch, member.id)

    const req = asRequest('POST', '/api/pins', {
      cookie: nonMember.sessionCookie,
      body: { channel_id: ch, message_id: msg },
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('forbidden')
  })

  it('returns 200 when member pins a message', async () => {
    const { POST } = await import('@/app/api/pins/route')
    const ws = await mkWorkspace(member.id)
    await addWorkspaceMember(ws, member.id)
    const ch = await mkPrivateChannel(ws)
    await addChannelMember(ch, member.id)
    const msg = await mkMessage(ch, member.id)

    const req = asRequest('POST', '/api/pins', {
      cookie: member.sessionCookie,
      body: { channel_id: ch, message_id: msg },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})

describe('DELETE /api/pins — channel RBAC', () => {
  it('returns 403 when non-member tries to unpin', async () => {
    const { DELETE } = await import('@/app/api/pins/route')
    const ws = await mkWorkspace(member.id)
    await addWorkspaceMember(ws, member.id)
    await addWorkspaceMember(ws, nonMember.id)
    const ch = await mkPrivateChannel(ws)
    await addChannelMember(ch, member.id)
    const msg = await mkMessage(ch, member.id)

    // Pin the message first (as member) so there's something to delete
    await ctx.pool.query(
      `INSERT INTO aaelink.pinned_messages (channel_id, message_id, pinned_by, pinned_at)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [ch, msg, member.id, Date.now()]
    )

    const req = asRequest('DELETE', '/api/pins', {
      cookie: nonMember.sessionCookie,
      body: { channel_id: ch, message_id: msg },
    })
    const res = await DELETE(req)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('forbidden')
  })
})
