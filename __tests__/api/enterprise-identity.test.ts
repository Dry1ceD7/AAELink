/**
 * Integration tests for D1 enterprise identity.
 *
 * Exercises lib/enterprise/enterpriseIdentity.ts against a live Postgres at the
 * function boundary. The route (app/api/admin/org/[orgId]/identity) is a thin
 * platform-admin + audit wrapper; route-level cookie auth is not available under
 * direct handler invocation in this harness (deep-audit __tests__/api cookie-
 * scope note).
 *
 * Covers getEnterpriseIdentity, listEnterpriseMembers, reconcileOrgMembership:
 * the operational↔enterprise membership bridge.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import {
  getEnterpriseIdentity,
  listEnterpriseMembers,
  reconcileOrgMembership,
} from '@/lib/enterprise/enterpriseIdentity'

let ctx: TestContext
let owner: TestUser
let wsUser: TestUser    // standing only via a workspace
let orgUser: TestUser   // standing only via an explicit org_members row
let stranger: TestUser  // no standing
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

async function addOrgRow(orgId: string, uid: string, role = 'member'): Promise<void> {
  await ctx.pool.query(
    `INSERT INTO aaelink.org_members (org_id, user_id, role)
     VALUES ($1, $2, $3) ON CONFLICT (org_id, user_id) DO UPDATE SET role = $3`,
    [orgId, uid, role]
  )
}

async function orgMemberRole(orgId: string, uid: string): Promise<string | null> {
  const { rows } = await ctx.pool.query<{ role: string }>(
    `SELECT role FROM aaelink.org_members WHERE org_id = $1 AND user_id = $2`,
    [orgId, uid]
  )
  return rows[0]?.role ?? null
}

beforeAll(async () => {
  ctx = await createTestContext()
  owner = await createTestUser(ctx.pool, { role: 'employee' })
  wsUser = await createTestUser(ctx.pool, { role: 'employee' })
  orgUser = await createTestUser(ctx.pool, { role: 'employee' })
  stranger = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(owner.id, wsUser.id, orgUser.id, stranger.id)
})

afterAll(async () => {
  if (orgIds.length) await ctx.pool.query(`DELETE FROM aaelink.org_members WHERE org_id = ANY($1)`, [orgIds])
  if (wsIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE workspace_id = ANY($1)`, [wsIds])
    await ctx.pool.query(`DELETE FROM aaelink.workspaces WHERE id = ANY($1)`, [wsIds])
  }
  if (orgIds.length) await ctx.pool.query(`DELETE FROM aaelink.organizations WHERE id = ANY($1)`, [orgIds])
  await ctx.pool.query(`DELETE FROM aaelink.org_members WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('getEnterpriseIdentity', () => {
  it('returns null for a user with no standing in the org', async () => {
    const org = await mkOrg()
    expect(await getEnterpriseIdentity(ctx.pool, org, stranger.id)).toBeNull()
  })

  it('derives membership from workspace standing alone (org_role null)', async () => {
    const org = await mkOrg()
    const wsA = await mkWorkspace(org)
    const wsB = await mkWorkspace(org)
    await addWsMember(wsA, wsUser.id, 'member')
    await addWsMember(wsB, wsUser.id, 'admin')

    const id = await getEnterpriseIdentity(ctx.pool, org, wsUser.id)
    expect(id?.is_member).toBe(true)
    expect(id?.org_role).toBeNull()
    expect(id?.workspaces.map(w => w.workspace_id).sort()).toEqual([wsA, wsB].sort())
  })

  it('reports an explicit org role even with no workspace standing', async () => {
    const org = await mkOrg()
    await addOrgRow(org, orgUser.id, 'org_admin')
    const id = await getEnterpriseIdentity(ctx.pool, org, orgUser.id)
    expect(id?.is_member).toBe(true)
    expect(id?.org_role).toBe('org_admin')
    expect(id?.workspaces).toEqual([])
  })

  it('does not leak standing from a different org', async () => {
    const orgA = await mkOrg()
    const orgB = await mkOrg()
    const wsA = await mkWorkspace(orgA)
    await addWsMember(wsA, wsUser.id, 'member')
    expect(await getEnterpriseIdentity(ctx.pool, orgB, wsUser.id)).toBeNull()
  })
})

describe('listEnterpriseMembers', () => {
  it('unions org_members and workspace standing, with derived role + workspace count', async () => {
    const org = await mkOrg()
    const wsA = await mkWorkspace(org)
    const wsB = await mkWorkspace(org)
    await addWsMember(wsA, wsUser.id, 'member')
    await addWsMember(wsB, wsUser.id, 'member')   // wsUser in 2 workspaces, no org row
    await addOrgRow(org, orgUser.id, 'org_owner') // orgUser only via org_members
    await addWsMember(wsA, owner.id, 'owner')
    await addOrgRow(org, owner.id, 'org_admin')   // owner via both

    const members = await listEnterpriseMembers(ctx.pool, org)
    const byId = new Map(members.map(m => [m.user_id, m]))

    expect(byId.get(wsUser.id)?.org_role).toBeNull()
    expect(byId.get(wsUser.id)?.workspace_count).toBe(2)
    expect(byId.get(orgUser.id)?.org_role).toBe('org_owner')
    expect(byId.get(orgUser.id)?.workspace_count).toBe(0)
    expect(byId.get(owner.id)?.org_role).toBe('org_admin')
    expect(byId.get(owner.id)?.workspace_count).toBe(1)
    expect(byId.has(stranger.id)).toBe(false)
  })
})

describe('reconcileOrgMembership', () => {
  it('backfills org_members from workspace standing without touching existing roles', async () => {
    const org = await mkOrg()
    const wsA = await mkWorkspace(org)
    await addWsMember(wsA, wsUser.id, 'member')   // no org row yet
    await addWsMember(wsA, owner.id, 'owner')
    await addOrgRow(org, owner.id, 'org_owner')   // pre-existing role must survive

    expect(await orgMemberRole(org, wsUser.id)).toBeNull()

    const added = await reconcileOrgMembership(ctx.pool, org)
    expect(added).toBe(1) // only wsUser added; owner already present

    expect(await orgMemberRole(org, wsUser.id)).toBe('member')
    expect(await orgMemberRole(org, owner.id)).toBe('org_owner') // unchanged

    // Idempotent: a second pass adds nothing.
    expect(await reconcileOrgMembership(ctx.pool, org)).toBe(0)
  })
})
