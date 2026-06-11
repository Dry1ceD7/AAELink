/**
 * Integration tests for D4 cross-workspace org search.
 *
 * Exercises lib/messaging/orgSearch.ts against a live Postgres. Verifies the
 * search spans sibling workspaces of the caller's org, stays inside that org,
 * and respects channel visibility. The route (app/api/search/org-messages) is a
 * thin session wrapper.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import { searchOrgMessages } from '@/lib/messaging/orgSearch'

let ctx: TestContext
let user: TestUser
const userIds: string[] = []
const orgIds: string[] = []
const wsIds: string[] = []
const chIds: string[] = []
const msgIds: string[] = []
const MARK = `needle${randomUUID().slice(0, 8)}` // unique token isolating this suite's messages

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
    [id, `WS ${id.slice(-6)}`, user.id, Date.now(), orgId]
  )
  wsIds.push(id)
  return id
}

async function addWsMember(wsId: string, uid: string): Promise<void> {
  await ctx.pool.query(
    `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
    [wsId, uid]
  )
}

async function mkChannel(wsId: string, opts: { type?: string; orgWideOrgId?: string } = {}): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, created_at, is_org_wide, org_id, archived_at)
     VALUES ($1, $2, $3, $3, $4, $5, $6, $7, 0)`,
    [id, wsId, `ch-${id.slice(0, 8)}`, opts.type ?? 'O', Date.now(), Boolean(opts.orgWideOrgId), opts.orgWideOrgId ?? null]
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

async function mkMessage(chId: string, uid: string): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '', $5, $5)`,
    [id, chId, uid, `contains ${MARK} token`, Date.now()]
  )
  msgIds.push(id)
  return id
}

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(user.id)
})

afterAll(async () => {
  if (msgIds.length) await ctx.pool.query(`DELETE FROM aaelink.messages WHERE id = ANY($1)`, [msgIds])
  if (chIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.channel_members WHERE channel_id = ANY($1)`, [chIds])
    await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = ANY($1)`, [chIds])
  }
  if (wsIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE workspace_id = ANY($1)`, [wsIds])
    await ctx.pool.query(`DELETE FROM aaelink.workspaces WHERE id = ANY($1)`, [wsIds])
  }
  if (orgIds.length) await ctx.pool.query(`DELETE FROM aaelink.organizations WHERE id = ANY($1)`, [orgIds])
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('searchOrgMessages', () => {
  it('returns empty for a too-short query', async () => {
    expect(await searchOrgMessages(ctx.pool, user.id, 'a')).toEqual({ results: [], total: 0, limit: 25, offset: 0 })
  })

  it('spans sibling workspaces in the org but stays inside it and respects visibility', async () => {
    const orgA = await mkOrg()
    const orgB = await mkOrg()
    const homeWs = await mkWorkspace(orgA)
    const siblingWs = await mkWorkspace(orgA)
    const otherOrgWs = await mkWorkspace(orgB)
    await addWsMember(homeWs, user.id) // user belongs to orgA via homeWs only

    // Reachable:
    const memberCh = await mkChannel(homeWs, { type: 'P' }) // private but member
    await addChannelMember(memberCh, user.id)
    const memberMsg = await mkMessage(memberCh, user.id)

    const siblingPublic = await mkChannel(siblingWs, { type: 'O' }) // public in sibling ws, same org
    const siblingMsg = await mkMessage(siblingPublic, user.id)

    const orgWide = await mkChannel(siblingWs, { type: 'O', orgWideOrgId: orgA })
    const orgWideMsg = await mkMessage(orgWide, user.id)

    // Not reachable:
    const siblingPrivate = await mkChannel(siblingWs, { type: 'P' }) // private, not a member
    const privateMsg = await mkMessage(siblingPrivate, user.id)

    const otherOrgPublic = await mkChannel(otherOrgWs, { type: 'O' }) // public but different org
    const otherOrgMsg = await mkMessage(otherOrgPublic, user.id)

    const found = await searchOrgMessages(ctx.pool, user.id, MARK, { limit: 50 })
    const ids = found.results.map(r => r.message_id)

    expect(ids).toContain(memberMsg)
    expect(ids).toContain(siblingMsg)   // cross-workspace, same org
    expect(ids).toContain(orgWideMsg)
    expect(ids).not.toContain(privateMsg)
    expect(ids).not.toContain(otherOrgMsg) // org isolation
  })

  it('paginates', async () => {
    const page = await searchOrgMessages(ctx.pool, user.id, MARK, { limit: 1, offset: 0 })
    expect(page.results.length).toBe(1)
    expect(page.total).toBeGreaterThanOrEqual(3)
    expect(page.limit).toBe(1)
  })
})
