/**
 * Integration tests for D1 org-wide channels.
 *
 * Exercises lib/channels/orgWideChannels.ts against a live Postgres at the
 * function boundary. The routes (app/api/channels/[id]/org-wide,
 * app/api/channels/org-wide) are thin auth + audit + error-map wrappers;
 * route-level cookie auth is not available under direct handler invocation in
 * this harness (deep-audit __tests__/api cookie-scope note).
 *
 * Covers promoteChannelToOrgWide, demoteOrgWideChannel, listOrgWideChannels,
 * joinOrgWideChannel: every rejection code and the success paths.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import {
  promoteChannelToOrgWide,
  demoteOrgWideChannel,
  listOrgWideChannels,
  joinOrgWideChannel,
} from '@/lib/channels/orgWideChannels'

let ctx: TestContext
let owner: TestUser
let member: TestUser
let stranger: TestUser
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
    `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [wsId, uid, role]
  )
}

async function mkChannel(
  wsId: string,
  opts: { type?: string; orgWideOrgId?: string; archived?: boolean } = {}
): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, created_at, is_org_wide, org_id, archived_at)
     VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      wsId,
      `ch-${id.slice(0, 8)}`,
      opts.type ?? 'O',
      Date.now(),
      Boolean(opts.orgWideOrgId),
      opts.orgWideOrgId ?? null,
      opts.archived ? Date.now() : 0,
    ]
  )
  chIds.push(id)
  return id
}

async function isMember(chId: string, uid: string): Promise<boolean> {
  const { rows } = await ctx.pool.query(
    `SELECT 1 FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`,
    [chId, uid]
  )
  return rows.length > 0
}

beforeAll(async () => {
  ctx = await createTestContext()
  owner = await createTestUser(ctx.pool, { role: 'employee' })
  member = await createTestUser(ctx.pool, { role: 'employee' })
  stranger = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(owner.id, member.id, stranger.id)
})

afterAll(async () => {
  if (chIds.length) {
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

describe('promoteChannelToOrgWide', () => {
  it('rejects a non-member of the home workspace (not_found)', async () => {
    const org = await mkOrg()
    const ws = await mkWorkspace(org)
    await addWsMember(ws, owner.id, 'owner')
    const ch = await mkChannel(ws)
    expect(await promoteChannelToOrgWide(ctx.pool, stranger.id, ch)).toEqual({ ok: false, code: 'not_found' })
  })

  it('rejects a non-owner member (forbidden)', async () => {
    const org = await mkOrg()
    const ws = await mkWorkspace(org)
    await addWsMember(ws, owner.id, 'owner')
    await addWsMember(ws, member.id, 'member')
    const ch = await mkChannel(ws)
    expect(await promoteChannelToOrgWide(ctx.pool, member.id, ch)).toEqual({ ok: false, code: 'forbidden' })
  })

  it('rejects a non-public channel (not_public)', async () => {
    const org = await mkOrg()
    const ws = await mkWorkspace(org)
    await addWsMember(ws, owner.id, 'owner')
    const ch = await mkChannel(ws, { type: 'P' })
    expect(await promoteChannelToOrgWide(ctx.pool, owner.id, ch)).toEqual({ ok: false, code: 'not_public' })
  })

  it('rejects a channel whose workspace has no org (no_org)', async () => {
    const ws = await mkWorkspace(null)
    await addWsMember(ws, owner.id, 'owner')
    const ch = await mkChannel(ws)
    expect(await promoteChannelToOrgWide(ctx.pool, owner.id, ch)).toEqual({ ok: false, code: 'no_org' })
  })

  it('promotes for the owner and guards re-promote (already_org_wide)', async () => {
    const org = await mkOrg()
    const ws = await mkWorkspace(org)
    await addWsMember(ws, owner.id, 'owner')
    const ch = await mkChannel(ws)
    expect(await promoteChannelToOrgWide(ctx.pool, owner.id, ch)).toEqual({ ok: true, channelId: ch, orgId: org })

    const { rows } = await ctx.pool.query<{ is_org_wide: boolean; org_id: string }>(
      `SELECT is_org_wide, org_id::text FROM aaelink.channels WHERE id = $1`, [ch]
    )
    expect(rows[0]?.is_org_wide).toBe(true)
    expect(rows[0]?.org_id).toBe(org)

    expect(await promoteChannelToOrgWide(ctx.pool, owner.id, ch)).toEqual({ ok: false, code: 'already_org_wide' })
  })
})

describe('demoteOrgWideChannel', () => {
  it('rejects a channel that is not org-wide (not_org_wide)', async () => {
    const org = await mkOrg()
    const ws = await mkWorkspace(org)
    await addWsMember(ws, owner.id, 'owner')
    const ch = await mkChannel(ws)
    expect(await demoteOrgWideChannel(ctx.pool, owner.id, ch)).toEqual({ ok: false, code: 'not_org_wide' })
  })

  it('demotes an org-wide channel for the owner', async () => {
    const org = await mkOrg()
    const ws = await mkWorkspace(org)
    await addWsMember(ws, owner.id, 'owner')
    const ch = await mkChannel(ws, { orgWideOrgId: org })
    expect(await demoteOrgWideChannel(ctx.pool, owner.id, ch)).toEqual({ ok: true, channelId: ch })
    const { rows } = await ctx.pool.query<{ is_org_wide: boolean; org_id: string | null }>(
      `SELECT is_org_wide, org_id FROM aaelink.channels WHERE id = $1`, [ch]
    )
    expect(rows[0]?.is_org_wide).toBe(false)
    expect(rows[0]?.org_id).toBeNull()
  })
})

describe('listOrgWideChannels', () => {
  it('returns only org-wide, same-org, active, not-joined channels', async () => {
    const orgA = await mkOrg()
    const orgB = await mkOrg()
    const wsA = await mkWorkspace(orgA)
    const wsB = await mkWorkspace(orgB)
    await addWsMember(wsA, member.id, 'member') // member has standing in orgA only

    const visible = await mkChannel(wsA, { orgWideOrgId: orgA })
    const plain = await mkChannel(wsA)                                   // not org-wide
    const archived = await mkChannel(wsA, { orgWideOrgId: orgA, archived: true })
    const otherOrg = await mkChannel(wsB, { orgWideOrgId: orgB })        // member not in orgB
    const joined = await mkChannel(wsA, { orgWideOrgId: orgA })
    await ctx.pool.query(
      `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at) VALUES ($1, $2, 'member', $3)`,
      [joined, member.id, Date.now()]
    )

    const ids = (await listOrgWideChannels(ctx.pool, member.id)).map(c => c.id)
    expect(ids).toContain(visible)
    expect(ids).not.toContain(plain)
    expect(ids).not.toContain(archived)
    expect(ids).not.toContain(otherOrg)
    expect(ids).not.toContain(joined)
  })
})

describe('joinOrgWideChannel', () => {
  it('rejects an unknown channel (not_found)', async () => {
    expect(await joinOrgWideChannel(ctx.pool, member.id, 'nope')).toEqual({ ok: false, code: 'not_found' })
  })

  it('rejects a non-org-wide channel (not_org_wide)', async () => {
    const org = await mkOrg()
    const ws = await mkWorkspace(org)
    await addWsMember(ws, member.id, 'member')
    const ch = await mkChannel(ws)
    expect(await joinOrgWideChannel(ctx.pool, member.id, ch)).toEqual({ ok: false, code: 'not_org_wide' })
  })

  it('rejects a channel in an org the caller has no standing in (not_in_org)', async () => {
    const org = await mkOrg()
    const ws = await mkWorkspace(org)
    const ch = await mkChannel(ws, { orgWideOrgId: org })
    expect(await joinOrgWideChannel(ctx.pool, stranger.id, ch)).toEqual({ ok: false, code: 'not_in_org' })
  })

  it('joins an org-wide channel, then reports already_member and drops from discovery', async () => {
    const org = await mkOrg()
    const ws = await mkWorkspace(org)
    await addWsMember(ws, member.id, 'member')
    const ch = await mkChannel(ws, { orgWideOrgId: org })

    expect(await joinOrgWideChannel(ctx.pool, member.id, ch)).toEqual({ ok: true, channelId: ch })
    expect(await isMember(ch, member.id)).toBe(true)

    expect(await joinOrgWideChannel(ctx.pool, member.id, ch)).toEqual({ ok: false, code: 'already_member' })

    const ids = (await listOrgWideChannels(ctx.pool, member.id)).map(c => c.id)
    expect(ids).not.toContain(ch)
  })
})
