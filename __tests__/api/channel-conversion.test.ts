/**
 * Integration tests for D3 channel type conversion (public <-> private).
 *
 * Exercises lib/channels/channelConversion.ts against a live Postgres. The route
 * (app/api/channels/[id]/convert) is a thin session + CSRF + audit wrapper.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import { convertChannelType } from '@/lib/channels/channelConversion'

let ctx: TestContext
let owner: TestUser
let member: TestUser
const userIds: string[] = []
const orgIds: string[] = []
const wsIds: string[] = []
const chIds: string[] = []

async function mkOrg(): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.organizations (id, name, domain) VALUES ($1, $2, $3)`,
    [id, `Org ${id.slice(0, 6)}`, `${id.slice(0, 8)}.example.test`]
  )
  orgIds.push(id)
  return id
}

async function mkWorkspace(orgId: string | null): Promise<string> {
  const id = `ws-${randomUUID().slice(0, 12)}`
  await ctx.pool.query(
    `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system, org_id, access_level)
     VALUES ($1, $1, $2, $3, $4, false, $5, 'invite_only')`,
    [id, `WS ${id.slice(-6)}`, owner.id, Date.now(), orgId]
  )
  wsIds.push(id)
  return id
}

async function addWsMember(wsId: string, uid: string, role = 'member'): Promise<void> {
  await ctx.pool.query(
    `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [wsId, uid, role]
  )
}

async function mkChannel(
  wsId: string,
  opts: { type?: string; orgWideOrgId?: string } = {}
): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, created_at, is_org_wide, org_id, archived_at)
     VALUES ($1, $2, $3, $3, $4, $5, $6, $7, 0)`,
    [id, wsId, `ch-${id.slice(0, 8)}`, opts.type ?? 'O', Date.now(), Boolean(opts.orgWideOrgId), opts.orgWideOrgId ?? null]
  )
  chIds.push(id)
  return id
}

async function addChannelMember(chId: string, uid: string, role = 'member'): Promise<void> {
  await ctx.pool.query(
    `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [chId, uid, role, Date.now()]
  )
}

async function channelType(chId: string): Promise<string> {
  const { rows } = await ctx.pool.query<{ type: string }>(`SELECT type FROM aaelink.channels WHERE id = $1`, [chId])
  return rows[0]?.type ?? ''
}

beforeAll(async () => {
  ctx = await createTestContext()
  owner = await createTestUser(ctx.pool, { role: 'employee' })
  member = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(owner.id, member.id)
})

afterAll(async () => {
  if (chIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.channel_workspaces WHERE channel_id = ANY($1)`, [chIds])
    await ctx.pool.query(`DELETE FROM aaelink.channel_members WHERE channel_id = ANY($1)`, [chIds])
    await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = ANY($1)`, [chIds])
  }
  if (wsIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE workspace_id = ANY($1)`, [wsIds])
    await ctx.pool.query(`DELETE FROM aaelink.workspaces WHERE id = ANY($1)`, [wsIds])
  }
  if (orgIds.length) await ctx.pool.query(`DELETE FROM aaelink.organizations WHERE id = ANY($1)`, [orgIds])
  await ctx.pool.query(`DELETE FROM aaelink.channel_members WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('convertChannelType', () => {
  it('rejects an invalid target type', async () => {
    const ws = await mkWorkspace(null)
    await addWsMember(ws, owner.id, 'owner')
    const ch = await mkChannel(ws)
    expect(await convertChannelType(ctx.pool, owner.id, ch, 'X')).toEqual({ ok: false, code: 'invalid_type' })
  })

  it('rejects an unknown channel (not_found)', async () => {
    expect(await convertChannelType(ctx.pool, owner.id, 'nope', 'P')).toEqual({ ok: false, code: 'not_found' })
  })

  it('rejects a DM channel', async () => {
    const ws = await mkWorkspace(null)
    await addWsMember(ws, owner.id, 'owner')
    const ch = await mkChannel(ws, { type: 'D' })
    expect(await convertChannelType(ctx.pool, owner.id, ch, 'P')).toEqual({ ok: false, code: 'cannot_convert_dm' })
  })

  it('rejects a non-admin, non-owner caller (forbidden)', async () => {
    const ws = await mkWorkspace(null)
    await addWsMember(ws, owner.id, 'owner')
    await addWsMember(ws, member.id, 'member')
    const ch = await mkChannel(ws)
    await addChannelMember(ch, member.id, 'member')
    expect(await convertChannelType(ctx.pool, member.id, ch, 'P')).toEqual({ ok: false, code: 'forbidden' })
  })

  it('rejects converting to the same type', async () => {
    const ws = await mkWorkspace(null)
    await addWsMember(ws, owner.id, 'owner')
    const ch = await mkChannel(ws, { type: 'O' })
    expect(await convertChannelType(ctx.pool, owner.id, ch, 'O')).toEqual({ ok: false, code: 'same_type' })
  })

  it('refuses to make an org-wide channel private', async () => {
    const org = await mkOrg()
    const ws = await mkWorkspace(org)
    await addWsMember(ws, owner.id, 'owner')
    const ch = await mkChannel(ws, { type: 'O', orgWideOrgId: org })
    expect(await convertChannelType(ctx.pool, owner.id, ch, 'P')).toEqual({ ok: false, code: 'org_wide_conflict' })
  })

  it('refuses to make a multi-workspace-shared channel private', async () => {
    const org = await mkOrg()
    const ws = await mkWorkspace(org)
    const target = await mkWorkspace(org)
    await addWsMember(ws, owner.id, 'owner')
    const ch = await mkChannel(ws, { type: 'O' })
    await ctx.pool.query(
      `INSERT INTO aaelink.channel_workspaces (channel_id, workspace_id, added_by, added_at) VALUES ($1, $2, $3, $4)`,
      [ch, target, owner.id, Date.now()]
    )
    expect(await convertChannelType(ctx.pool, owner.id, ch, 'P')).toEqual({ ok: false, code: 'shared_conflict' })
  })

  it('converts public->private for a workspace owner and back for a channel admin', async () => {
    const ws = await mkWorkspace(null)
    await addWsMember(ws, owner.id, 'owner')
    const ch = await mkChannel(ws, { type: 'O' })

    expect(await convertChannelType(ctx.pool, owner.id, ch, 'P')).toEqual({ ok: true, channelId: ch, type: 'P' })
    expect(await channelType(ch)).toBe('P')

    // A channel admin (not ws owner) can convert it back.
    await addWsMember(ws, member.id, 'member')
    await addChannelMember(ch, member.id, 'admin')
    expect(await convertChannelType(ctx.pool, member.id, ch, 'O')).toEqual({ ok: true, channelId: ch, type: 'O' })
    expect(await channelType(ch)).toBe('O')
  })
})
