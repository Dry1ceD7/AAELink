/**
 * Integration tests for D1 workspace discovery.
 *
 * Exercises the discovery/join logic at the lib layer
 * (lib/workspace/workspaceDiscovery.ts) against a live Postgres. The route
 * (app/api/workspaces/discover/route.ts) is a thin auth + audit + error-map
 * wrapper over these functions; route-level auth uses cookies() which is not
 * available under direct handler invocation in this harness (see the
 * deep-audit note on the __tests__/api cookie-scope limitation), so the
 * meaningful behavior is verified here at the function boundary.
 *
 * Covers:
 *   - listDiscoverableWorkspaces: only open, same-org, not-joined workspaces.
 *   - joinOpenWorkspace: success + default-channel auto-join, and every
 *     rejection code (not_found, not_open, already_member, not_in_org).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import { listDiscoverableWorkspaces, joinOpenWorkspace } from '@/lib/workspace/workspaceDiscovery'

let ctx: TestContext
let user: TestUser
const userIds: string[] = []
const orgIds: string[] = []
const wsIds: string[] = []

async function mkOrg(): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.organizations (id, name, domain) VALUES ($1, $2, $3)`,
    [id, `Org ${id.slice(0, 6)}`, `${id.slice(0, 8)}.example.test`]
  )
  orgIds.push(id)
  return id
}

async function mkWorkspace(opts: { orgId: string | null; access: string; withDefaultChannel?: boolean }): Promise<string> {
  const id = `ws-${randomUUID().slice(0, 12)}`
  await ctx.pool.query(
    `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system, org_id, access_level)
     VALUES ($1, $1, $2, $3, $4, false, $5, $6)`,
    [id, `WS ${id.slice(-6)}`, user.id, Date.now(), opts.orgId, opts.access]
  )
  wsIds.push(id)
  if (opts.withDefaultChannel) {
    await ctx.pool.query(
      `INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, is_default, created_at)
       VALUES ($1, $2, 'general', 'General', 'O', TRUE, $3)`,
      [randomUUID(), id, Date.now()]
    )
  }
  return id
}

async function addMember(wsId: string, uid: string): Promise<void> {
  await ctx.pool.query(
    `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
    [wsId, uid]
  )
}

let orgA: string
let homeWs: string
let openWs: string
let inviteWs: string
let orglessOpenWs: string
let otherOrgOpenWs: string

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(user.id)

  orgA = await mkOrg()
  const orgB = await mkOrg()

  homeWs = await mkWorkspace({ orgId: orgA, access: 'invite_only' })            // user's home ws
  openWs = await mkWorkspace({ orgId: orgA, access: 'open', withDefaultChannel: true }) // discoverable + joinable
  inviteWs = await mkWorkspace({ orgId: orgA, access: 'invite_only' })          // not discoverable
  orglessOpenWs = await mkWorkspace({ orgId: null, access: 'open' })            // no org -> excluded
  otherOrgOpenWs = await mkWorkspace({ orgId: orgB, access: 'open' })           // other org -> excluded

  await addMember(homeWs, user.id)
})

afterAll(async () => {
  if (wsIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.channel_members WHERE user_id = ANY($1)`, [userIds])
    await ctx.pool.query(`DELETE FROM aaelink.channels WHERE workspace_id = ANY($1)`, [wsIds])
    await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE workspace_id = ANY($1)`, [wsIds])
    await ctx.pool.query(`DELETE FROM aaelink.workspaces WHERE id = ANY($1)`, [wsIds])
  }
  if (orgIds.length) await ctx.pool.query(`DELETE FROM aaelink.organizations WHERE id = ANY($1)`, [orgIds])
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('listDiscoverableWorkspaces', () => {
  it('returns only open, same-org, not-joined workspaces', async () => {
    const rows = await listDiscoverableWorkspaces(ctx.pool, user.id)
    const ids = rows.map(w => w.id)
    expect(ids).toContain(openWs)
    expect(ids).not.toContain(homeWs)         // already a member
    expect(ids).not.toContain(inviteWs)       // not open
    expect(ids).not.toContain(orglessOpenWs)  // no org
    expect(ids).not.toContain(otherOrgOpenWs) // different org
  })

  it('reports a member_count for discoverable workspaces', async () => {
    const rows = await listDiscoverableWorkspaces(ctx.pool, user.id)
    const open = rows.find(w => w.id === openWs)
    expect(open).toBeDefined()
    expect(typeof open!.member_count).toBe('number')
  })
})

describe('joinOpenWorkspace', () => {
  it('rejects an unknown workspace (not_found)', async () => {
    const r = await joinOpenWorkspace(ctx.pool, user.id, 'ws-does-not-exist')
    expect(r).toEqual({ ok: false, code: 'not_found' })
  })

  it('rejects an invite_only workspace (not_open)', async () => {
    const r = await joinOpenWorkspace(ctx.pool, user.id, inviteWs)
    expect(r).toEqual({ ok: false, code: 'not_open' })
  })

  it('rejects a workspace in another org (not_in_org)', async () => {
    const r = await joinOpenWorkspace(ctx.pool, user.id, otherOrgOpenWs)
    expect(r).toEqual({ ok: false, code: 'not_in_org' })
  })

  it('rejects an org-less open workspace (not_in_org)', async () => {
    const r = await joinOpenWorkspace(ctx.pool, user.id, orglessOpenWs)
    expect(r).toEqual({ ok: false, code: 'not_in_org' })
  })

  it('joins an open same-org workspace, auto-joins the default channel, then reports already_member', async () => {
    const r = await joinOpenWorkspace(ctx.pool, user.id, openWs)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.workspaceId).toBe(openWs)

    const { rows: mem } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [openWs, user.id]
    )
    expect(mem.length).toBe(1)

    // default channel auto-join
    const { rows: cm } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.channel_members cmb
         JOIN aaelink.channels c ON c.id = cmb.channel_id
        WHERE c.workspace_id = $1 AND c.is_default = TRUE AND cmb.user_id = $2`,
      [openWs, user.id]
    )
    expect(cm.length).toBe(1)

    const again = await joinOpenWorkspace(ctx.pool, user.id, openWs)
    expect(again).toEqual({ ok: false, code: 'already_member' })

    // once joined, it no longer appears in discovery
    const rows = await listDiscoverableWorkspaces(ctx.pool, user.id)
    expect(rows.map(w => w.id)).not.toContain(openWs)
  })
})
