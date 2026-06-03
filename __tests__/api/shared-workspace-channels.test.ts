/**
 * Integration tests for D1 multi-workspace shared channels.
 *
 * Exercises lib/channels/sharedWorkspaceChannels.ts against a live Postgres at
 * the function boundary. The routes (app/api/channels/[id]/shared-workspaces,
 * app/api/channels/shared-workspaces) are thin auth + audit + error-map
 * wrappers; route-level cookie auth is not available under direct handler
 * invocation in this harness (deep-audit __tests__/api cookie-scope note).
 *
 * Covers shareChannelToWorkspace, unshareChannelFromWorkspace,
 * listSharedWorkspaceChannels, joinSharedWorkspaceChannel: every rejection code
 * and the success paths.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import {
  shareChannelToWorkspace,
  unshareChannelFromWorkspace,
  listSharedWorkspaceChannels,
  joinSharedWorkspaceChannel,
} from '@/lib/channels/sharedWorkspaceChannels'

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
  opts: { type?: string; archived?: boolean } = {}
): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, created_at, archived_at)
     VALUES ($1, $2, $3, $3, $4, $5, $6)`,
    [id, wsId, `ch-${id.slice(0, 8)}`, opts.type ?? 'O', Date.now(), opts.archived ? Date.now() : 0]
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

async function isShared(chId: string, wsId: string): Promise<boolean> {
  const { rows } = await ctx.pool.query(
    `SELECT 1 FROM aaelink.channel_workspaces WHERE channel_id = $1 AND workspace_id = $2`,
    [chId, wsId]
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

describe('shareChannelToWorkspace', () => {
  it('rejects a non-member of the home workspace (not_found)', async () => {
    const org = await mkOrg()
    const home = await mkWorkspace(org)
    const target = await mkWorkspace(org)
    await addWsMember(home, owner.id, 'owner')
    const ch = await mkChannel(home)
    expect(await shareChannelToWorkspace(ctx.pool, stranger.id, ch, target)).toEqual({ ok: false, code: 'not_found' })
  })

  it('rejects a non-owner member (forbidden)', async () => {
    const org = await mkOrg()
    const home = await mkWorkspace(org)
    const target = await mkWorkspace(org)
    await addWsMember(home, owner.id, 'owner')
    await addWsMember(home, member.id, 'member')
    const ch = await mkChannel(home)
    expect(await shareChannelToWorkspace(ctx.pool, member.id, ch, target)).toEqual({ ok: false, code: 'forbidden' })
  })

  it('rejects a non-public channel (not_public)', async () => {
    const org = await mkOrg()
    const home = await mkWorkspace(org)
    const target = await mkWorkspace(org)
    await addWsMember(home, owner.id, 'owner')
    const ch = await mkChannel(home, { type: 'P' })
    expect(await shareChannelToWorkspace(ctx.pool, owner.id, ch, target)).toEqual({ ok: false, code: 'not_public' })
  })

  it('rejects a channel whose home workspace has no org (no_org)', async () => {
    const home = await mkWorkspace(null)
    const target = await mkWorkspace(null)
    await addWsMember(home, owner.id, 'owner')
    const ch = await mkChannel(home)
    expect(await shareChannelToWorkspace(ctx.pool, owner.id, ch, target)).toEqual({ ok: false, code: 'no_org' })
  })

  it('rejects sharing into the home workspace itself (same_workspace)', async () => {
    const org = await mkOrg()
    const home = await mkWorkspace(org)
    await addWsMember(home, owner.id, 'owner')
    const ch = await mkChannel(home)
    expect(await shareChannelToWorkspace(ctx.pool, owner.id, ch, home)).toEqual({ ok: false, code: 'same_workspace' })
  })

  it('rejects an unknown target workspace (target_not_found)', async () => {
    const org = await mkOrg()
    const home = await mkWorkspace(org)
    await addWsMember(home, owner.id, 'owner')
    const ch = await mkChannel(home)
    expect(await shareChannelToWorkspace(ctx.pool, owner.id, ch, 'ws-nope')).toEqual({ ok: false, code: 'target_not_found' })
  })

  it('rejects a target workspace in a different org (cross_org)', async () => {
    const orgA = await mkOrg()
    const orgB = await mkOrg()
    const home = await mkWorkspace(orgA)
    const target = await mkWorkspace(orgB)
    await addWsMember(home, owner.id, 'owner')
    const ch = await mkChannel(home)
    expect(await shareChannelToWorkspace(ctx.pool, owner.id, ch, target)).toEqual({ ok: false, code: 'cross_org' })
  })

  it('shares for the owner and guards re-share (already_shared)', async () => {
    const org = await mkOrg()
    const home = await mkWorkspace(org)
    const target = await mkWorkspace(org)
    await addWsMember(home, owner.id, 'owner')
    const ch = await mkChannel(home)
    expect(await shareChannelToWorkspace(ctx.pool, owner.id, ch, target)).toEqual({ ok: true, channelId: ch, workspaceId: target })
    expect(await isShared(ch, target)).toBe(true)
    expect(await shareChannelToWorkspace(ctx.pool, owner.id, ch, target)).toEqual({ ok: false, code: 'already_shared' })
  })
})

describe('unshareChannelFromWorkspace', () => {
  it('rejects a non-owner (forbidden)', async () => {
    const org = await mkOrg()
    const home = await mkWorkspace(org)
    const target = await mkWorkspace(org)
    await addWsMember(home, owner.id, 'owner')
    await addWsMember(home, member.id, 'member')
    const ch = await mkChannel(home)
    await shareChannelToWorkspace(ctx.pool, owner.id, ch, target)
    expect(await unshareChannelFromWorkspace(ctx.pool, member.id, ch, target)).toEqual({ ok: false, code: 'forbidden' })
  })

  it('rejects a channel not shared into that workspace (not_shared)', async () => {
    const org = await mkOrg()
    const home = await mkWorkspace(org)
    const target = await mkWorkspace(org)
    await addWsMember(home, owner.id, 'owner')
    const ch = await mkChannel(home)
    expect(await unshareChannelFromWorkspace(ctx.pool, owner.id, ch, target)).toEqual({ ok: false, code: 'not_shared' })
  })

  it('unshares for the owner', async () => {
    const org = await mkOrg()
    const home = await mkWorkspace(org)
    const target = await mkWorkspace(org)
    await addWsMember(home, owner.id, 'owner')
    const ch = await mkChannel(home)
    await shareChannelToWorkspace(ctx.pool, owner.id, ch, target)
    expect(await unshareChannelFromWorkspace(ctx.pool, owner.id, ch, target)).toEqual({ ok: true, channelId: ch, workspaceId: target })
    expect(await isShared(ch, target)).toBe(false)
  })
})

describe('listSharedWorkspaceChannels', () => {
  it('returns only shared-into-my-workspace, active, not-home, not-joined channels', async () => {
    const org = await mkOrg()
    const home = await mkWorkspace(org)
    const target = await mkWorkspace(org)
    const otherWs = await mkWorkspace(org)
    await addWsMember(home, owner.id, 'owner')
    await addWsMember(target, member.id, 'member') // member discovers via `target`

    const visible = await mkChannel(home)
    await shareChannelToWorkspace(ctx.pool, owner.id, visible, target)

    const archived = await mkChannel(home, { archived: true })
    await ctx.pool.query(
      `INSERT INTO aaelink.channel_workspaces (channel_id, workspace_id, added_by, added_at) VALUES ($1, $2, $3, $4)`,
      [archived, target, owner.id, Date.now()]
    )

    const otherWsChannel = await mkChannel(home)
    await shareChannelToWorkspace(ctx.pool, owner.id, otherWsChannel, otherWs) // shared, but not into member's ws

    const joined = await mkChannel(home)
    await shareChannelToWorkspace(ctx.pool, owner.id, joined, target)
    await ctx.pool.query(
      `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at) VALUES ($1, $2, 'member', $3)`,
      [joined, member.id, Date.now()]
    )

    const ids = (await listSharedWorkspaceChannels(ctx.pool, member.id)).map(c => c.id)
    expect(ids).toContain(visible)
    expect(ids).not.toContain(archived)
    expect(ids).not.toContain(otherWsChannel)
    expect(ids).not.toContain(joined)
  })

  it('hides channels whose home workspace the user already belongs to', async () => {
    const org = await mkOrg()
    const home = await mkWorkspace(org)
    const target = await mkWorkspace(org)
    await addWsMember(home, owner.id, 'owner')
    await addWsMember(home, member.id, 'member') // member is in the home ws
    await addWsMember(target, member.id, 'member')
    const ch = await mkChannel(home)
    await shareChannelToWorkspace(ctx.pool, owner.id, ch, target)

    const ids = (await listSharedWorkspaceChannels(ctx.pool, member.id)).map(c => c.id)
    expect(ids).not.toContain(ch)
  })
})

describe('joinSharedWorkspaceChannel', () => {
  it('rejects an unknown channel (not_found)', async () => {
    expect(await joinSharedWorkspaceChannel(ctx.pool, member.id, 'nope')).toEqual({ ok: false, code: 'not_found' })
  })

  it('rejects an archived channel (not_found)', async () => {
    const org = await mkOrg()
    const home = await mkWorkspace(org)
    const target = await mkWorkspace(org)
    await addWsMember(home, owner.id, 'owner')
    await addWsMember(target, member.id, 'member')
    const ch = await mkChannel(home, { archived: true })
    await ctx.pool.query(
      `INSERT INTO aaelink.channel_workspaces (channel_id, workspace_id, added_by, added_at) VALUES ($1, $2, $3, $4)`,
      [ch, target, owner.id, Date.now()]
    )
    expect(await joinSharedWorkspaceChannel(ctx.pool, member.id, ch)).toEqual({ ok: false, code: 'not_found' })
  })

  it('rejects a channel not shared into any of the caller workspaces (not_shared_to_user)', async () => {
    const org = await mkOrg()
    const home = await mkWorkspace(org)
    const target = await mkWorkspace(org)
    await addWsMember(home, owner.id, 'owner')
    const ch = await mkChannel(home)
    await shareChannelToWorkspace(ctx.pool, owner.id, ch, target) // stranger is in neither ws
    expect(await joinSharedWorkspaceChannel(ctx.pool, stranger.id, ch)).toEqual({ ok: false, code: 'not_shared_to_user' })
  })

  it('joins a shared channel, then reports already_member and drops from discovery', async () => {
    const org = await mkOrg()
    const home = await mkWorkspace(org)
    const target = await mkWorkspace(org)
    await addWsMember(home, owner.id, 'owner')
    await addWsMember(target, member.id, 'member')
    const ch = await mkChannel(home)
    await shareChannelToWorkspace(ctx.pool, owner.id, ch, target)

    expect(await joinSharedWorkspaceChannel(ctx.pool, member.id, ch)).toEqual({ ok: true, channelId: ch })
    expect(await isMember(ch, member.id)).toBe(true)

    expect(await joinSharedWorkspaceChannel(ctx.pool, member.id, ch)).toEqual({ ok: false, code: 'already_member' })

    const ids = (await listSharedWorkspaceChannels(ctx.pool, member.id)).map(c => c.id)
    expect(ids).not.toContain(ch)
  })
})
