/**
 * Integration tests for D1 workspace archive + move lifecycle.
 *
 * Exercises lib/workspace/workspaceLifecycle.ts against a live Postgres at the
 * function boundary. The routes (app/api/workspaces/[id]/archive|move) are thin
 * auth + audit + error-map wrappers; route-level cookie auth is not available
 * under direct handler invocation in this harness (see the deep-audit note on
 * the __tests__/api cookie-scope limitation), so the meaningful behavior is
 * verified here.
 *
 * Covers archiveWorkspace, unarchiveWorkspace, moveWorkspaceToOrg: every
 * rejection code and the success paths, plus the discovery exclusion of
 * archived workspaces.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import {
  archiveWorkspace,
  unarchiveWorkspace,
  moveWorkspaceToOrg,
} from '@/lib/workspace/workspaceLifecycle'
import { listDiscoverableWorkspaces } from '@/lib/workspace/workspaceDiscovery'

let ctx: TestContext
let owner: TestUser
let member: TestUser
let stranger: TestUser
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

async function mkWorkspace(opts: {
  orgId?: string | null
  access?: string
  system?: boolean
}): Promise<string> {
  const id = `ws-${randomUUID().slice(0, 12)}`
  await ctx.pool.query(
    `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system, org_id, access_level)
     VALUES ($1, $1, $2, $3, $4, $5, $6, $7)`,
    [id, `WS ${id.slice(-6)}`, owner.id, Date.now(), opts.system ?? false, opts.orgId ?? null, opts.access ?? 'invite_only']
  )
  wsIds.push(id)
  return id
}

async function addMember(wsId: string, uid: string, role = 'member'): Promise<void> {
  await ctx.pool.query(
    `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [wsId, uid, role]
  )
}

async function archivedAtOf(wsId: string): Promise<number> {
  const { rows } = await ctx.pool.query<{ archived_at: string }>(
    `SELECT archived_at::text FROM aaelink.workspaces WHERE id = $1`,
    [wsId]
  )
  return Number(rows[0]?.archived_at ?? -1)
}

async function orgOf(wsId: string): Promise<string | null> {
  const { rows } = await ctx.pool.query<{ org_id: string | null }>(
    `SELECT org_id FROM aaelink.workspaces WHERE id = $1`,
    [wsId]
  )
  return rows[0]?.org_id ?? null
}

beforeAll(async () => {
  ctx = await createTestContext()
  owner = await createTestUser(ctx.pool, { role: 'employee' })
  member = await createTestUser(ctx.pool, { role: 'employee' })
  stranger = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(owner.id, member.id, stranger.id)
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

describe('archiveWorkspace', () => {
  it('rejects a non-member (not_found, no existence leak)', async () => {
    const ws = await mkWorkspace({})
    await addMember(ws, owner.id, 'owner')
    expect(await archiveWorkspace(ctx.pool, stranger.id, ws)).toEqual({ ok: false, code: 'not_found' })
  })

  it('rejects a non-owner member (forbidden)', async () => {
    const ws = await mkWorkspace({})
    await addMember(ws, owner.id, 'owner')
    await addMember(ws, member.id, 'member')
    expect(await archiveWorkspace(ctx.pool, member.id, ws)).toEqual({ ok: false, code: 'forbidden' })
  })

  it('rejects the system workspace (system_workspace)', async () => {
    const ws = await mkWorkspace({ system: true })
    await addMember(ws, owner.id, 'owner')
    expect(await archiveWorkspace(ctx.pool, owner.id, ws)).toEqual({ ok: false, code: 'system_workspace' })
  })

  it('archives for the owner, sets archived_at, and guards re-archive (already_archived)', async () => {
    const ws = await mkWorkspace({})
    await addMember(ws, owner.id, 'owner')
    const r = await archiveWorkspace(ctx.pool, owner.id, ws)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.workspaceId).toBe(ws)
    expect(await archivedAtOf(ws)).toBeGreaterThan(0)

    expect(await archiveWorkspace(ctx.pool, owner.id, ws)).toEqual({ ok: false, code: 'already_archived' })
  })

  it('removes an archived open workspace from discovery', async () => {
    const org = await mkOrg()
    const home = await mkWorkspace({ orgId: org, access: 'invite_only' })
    await addMember(home, member.id, 'member')
    const open = await mkWorkspace({ orgId: org, access: 'open' })
    await addMember(open, owner.id, 'owner')

    let ids = (await listDiscoverableWorkspaces(ctx.pool, member.id)).map(w => w.id)
    expect(ids).toContain(open)

    await archiveWorkspace(ctx.pool, owner.id, open)
    ids = (await listDiscoverableWorkspaces(ctx.pool, member.id)).map(w => w.id)
    expect(ids).not.toContain(open)
  })
})

describe('unarchiveWorkspace', () => {
  it('rejects an active workspace (not_archived)', async () => {
    const ws = await mkWorkspace({})
    await addMember(ws, owner.id, 'owner')
    expect(await unarchiveWorkspace(ctx.pool, owner.id, ws)).toEqual({ ok: false, code: 'not_archived' })
  })

  it('rejects a non-owner member (forbidden)', async () => {
    const ws = await mkWorkspace({})
    await addMember(ws, owner.id, 'owner')
    await addMember(ws, member.id, 'member')
    await archiveWorkspace(ctx.pool, owner.id, ws)
    expect(await unarchiveWorkspace(ctx.pool, member.id, ws)).toEqual({ ok: false, code: 'forbidden' })
  })

  it('restores an archived workspace for the owner', async () => {
    const ws = await mkWorkspace({})
    await addMember(ws, owner.id, 'owner')
    await archiveWorkspace(ctx.pool, owner.id, ws)
    expect(await archivedAtOf(ws)).toBeGreaterThan(0)
    expect(await unarchiveWorkspace(ctx.pool, owner.id, ws)).toEqual({ ok: true, workspaceId: ws })
    expect(await archivedAtOf(ws)).toBe(0)
  })
})

describe('moveWorkspaceToOrg', () => {
  it('rejects a non-member (not_found)', async () => {
    const ws = await mkWorkspace({})
    await addMember(ws, owner.id, 'owner')
    expect(await moveWorkspaceToOrg(ctx.pool, stranger.id, ws, null)).toEqual({ ok: false, code: 'not_found' })
  })

  it('rejects a non-owner member (forbidden)', async () => {
    const ws = await mkWorkspace({})
    await addMember(ws, owner.id, 'owner')
    await addMember(ws, member.id, 'member')
    expect(await moveWorkspaceToOrg(ctx.pool, member.id, ws, null)).toEqual({ ok: false, code: 'forbidden' })
  })

  it('rejects the system workspace (system_workspace)', async () => {
    const ws = await mkWorkspace({ system: true })
    await addMember(ws, owner.id, 'owner')
    expect(await moveWorkspaceToOrg(ctx.pool, owner.id, ws, null)).toEqual({ ok: false, code: 'system_workspace' })
  })

  it('rejects a malformed or unknown target org (org_not_found)', async () => {
    const ws = await mkWorkspace({})
    await addMember(ws, owner.id, 'owner')
    expect(await moveWorkspaceToOrg(ctx.pool, owner.id, ws, 'not-a-uuid')).toEqual({ ok: false, code: 'org_not_found' })
    expect(await moveWorkspaceToOrg(ctx.pool, owner.id, ws, randomUUID())).toEqual({ ok: false, code: 'org_not_found' })
  })

  it('rejects moving into an org the caller has no standing in (not_in_org)', async () => {
    const targetOrg = await mkOrg()
    const ws = await mkWorkspace({})
    await addMember(ws, owner.id, 'owner')
    expect(await moveWorkspaceToOrg(ctx.pool, owner.id, ws, targetOrg)).toEqual({ ok: false, code: 'not_in_org' })
  })

  it('moves into an org the owner has standing in, then detaches to null', async () => {
    const org = await mkOrg()
    const sibling = await mkWorkspace({ orgId: org, access: 'invite_only' })
    await addMember(sibling, owner.id, 'member') // owner now has standing in org
    const ws = await mkWorkspace({})
    await addMember(ws, owner.id, 'owner')

    expect(await moveWorkspaceToOrg(ctx.pool, owner.id, ws, org)).toEqual({ ok: true, workspaceId: ws, orgId: org })
    expect(await orgOf(ws)).toBe(org)

    expect(await moveWorkspaceToOrg(ctx.pool, owner.id, ws, null)).toEqual({ ok: true, workspaceId: ws, orgId: null })
    expect(await orgOf(ws)).toBeNull()
  })
})
