/**
 * Integration tests for organization administration.
 *
 * Exercises the org admin lib layer (lib/enterprise/orgAdmin.ts) against a
 * live Postgres. Tests CRUD operations on organizations and workspace
 * binding/unbinding.
 *
 * Covers:
 *   - createOrganization: creates org with name, domain, plan
 *   - getOrganization: retrieves org by id
 *   - updateOrganization: updates name, domain, plan, settings
 *   - deleteOrganization: deletes org and returns success
 *   - listOrganizations: lists all orgs ordered by name
 *   - listOrgWorkspaces: lists workspaces bound to an org
 *   - addWorkspaceToOrg: binds workspace to org
 *   - removeWorkspaceFromOrg: unbinds workspace from org
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import {
  createOrganization,
  getOrganization,
  updateOrganization,
  deleteOrganization,
  listOrganizations,
  listOrgWorkspaces,
  addWorkspaceToOrg,
  removeWorkspaceFromOrg,
} from '@/lib/enterprise/orgAdmin'

let ctx: TestContext
let user: TestUser
const userIds: string[] = []
const orgIds: string[] = []
const wsIds: string[] = []

async function mkWorkspace(opts: { orgId: string | null }): Promise<string> {
  const id = `ws-${randomUUID().slice(0, 12)}`
  await ctx.pool.query(
    `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system, org_id)
     VALUES ($1, $1, $2, $3, $4, false, $5)`,
    [id, `WS ${id.slice(-6)}`, user.id, Date.now(), opts.orgId]
  )
  wsIds.push(id)
  return id
}

let org1Id: string
let org2Id: string
let org3Id: string
let wsA: string
let wsB: string
let wsC: string

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(user.id)
})

afterAll(async () => {
  // Clean up in FK dependency order
  if (wsIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.channel_members WHERE user_id = ANY($1)`, [userIds])
    await ctx.pool.query(`DELETE FROM aaelink.channels WHERE workspace_id = ANY($1)`, [wsIds])
    await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE workspace_id = ANY($1)`, [wsIds])
    await ctx.pool.query(`DELETE FROM aaelink.workspaces WHERE id = ANY($1)`, [wsIds])
  }
  if (orgIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.org_members WHERE org_id = ANY($1)`, [orgIds])
    await ctx.pool.query(`DELETE FROM aaelink.organizations WHERE id = ANY($1)`, [orgIds])
  }
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('createOrganization', () => {
  it('creates an organization with name, domain, and plan', async () => {
    const org = await createOrganization('Test Org 1', 'test-org-1.example.test', 'pro')
    expect(org).not.toBeNull()
    expect(org?.name).toBe('Test Org 1')
    expect(org?.domain).toBe('test-org-1.example.test')
    expect(org?.plan).toBe('pro')
    expect(org?.id).toBeDefined()
    expect(org?.created_at).toBeDefined()
    expect(org?.updated_at).toBeDefined()
    expect(typeof org?.settings).toBe('object')
    if (org) {
      org1Id = org.id
      orgIds.push(org.id)
    }
  })

  it('creates an organization with default plan (free)', async () => {
    const org = await createOrganization('Test Org 2', 'test-org-2.example.test')
    expect(org?.plan).toBe('free')
    if (org) {
      org2Id = org.id
      orgIds.push(org.id)
    }
  })

  it('creates an organization with default settings {}', async () => {
    const org = await createOrganization('Test Org 3', 'test-org-3.example.test', 'business_plus')
    expect(org?.settings).toEqual({})
    if (org) {
      org3Id = org.id
      orgIds.push(org.id)
    }
  })
})

describe('getOrganization', () => {
  it('retrieves an existing organization by id', async () => {
    const org = await getOrganization(org1Id)
    expect(org).not.toBeNull()
    expect(org?.id).toBe(org1Id)
    expect(org?.name).toBe('Test Org 1')
    expect(org?.domain).toBe('test-org-1.example.test')
    expect(org?.plan).toBe('pro')
  })

  it('returns null for a non-existent organization', async () => {
    const org = await getOrganization(randomUUID())
    expect(org).toBeNull()
  })
})

describe('updateOrganization', () => {
  it('updates organization name', async () => {
    const updated = await updateOrganization(org1Id, { name: 'Test Org 1 Updated' })
    expect(updated?.name).toBe('Test Org 1 Updated')
    expect(updated?.domain).toBe('test-org-1.example.test')
    expect(updated?.plan).toBe('pro')
  })

  it('updates organization domain', async () => {
    const updated = await updateOrganization(org2Id, { domain: 'test-org-2-new.example.test' })
    expect(updated?.domain).toBe('test-org-2-new.example.test')
  })

  it('updates organization plan', async () => {
    const updated = await updateOrganization(org2Id, { plan: 'enterprise_grid' })
    expect(updated?.plan).toBe('enterprise_grid')
  })

  it('updates organization settings', async () => {
    const settings = { custom_key: 'custom_value', nested: { count: 42 } }
    const updated = await updateOrganization(org3Id, { settings })
    expect(updated?.settings).toEqual(settings)
  })

  it('updates multiple fields at once', async () => {
    const updated = await updateOrganization(org3Id, {
      name: 'Multi Update',
      plan: 'business_plus',
      settings: { feature_x: true },
    })
    expect(updated?.name).toBe('Multi Update')
    expect(updated?.plan).toBe('business_plus')
    expect(updated?.settings).toEqual({ feature_x: true })
  })

  it('returns the same org when no updates provided', async () => {
    const org = await getOrganization(org1Id)
    const unchanged = await updateOrganization(org1Id, {})
    expect(unchanged?.id).toBe(org?.id)
    expect(unchanged?.name).toBe(org?.name)
  })

  it('updates updated_at timestamp', async () => {
    const before = await getOrganization(org1Id)
    // Wait a tiny bit to ensure timestamp changes
    await new Promise(resolve => setTimeout(resolve, 10))
    const after = await updateOrganization(org1Id, { name: 'Timestamp Test' })
    expect(after?.updated_at).not.toBe(before?.updated_at)
  })

  it('returns null for a non-existent organization', async () => {
    const updated = await updateOrganization(randomUUID(), { name: 'Does Not Exist' })
    expect(updated).toBeNull()
  })
})

describe('listOrganizations', () => {
  it('lists all organizations ordered by name', async () => {
    const orgs = await listOrganizations()
    expect(Array.isArray(orgs)).toBe(true)
    expect(orgs.length).toBeGreaterThanOrEqual(3)

    // Find our test orgs
    const testOrgs = orgs.filter(o => orgIds.includes(o.id))
    expect(testOrgs.length).toBe(3)

    // Verify ordered by name
    const names = testOrgs.map(o => o.name)
    expect(names).toEqual([...names].sort())
  })

  it('includes all required fields in listing', async () => {
    const orgs = await listOrganizations()
    const testOrg = orgs.find(o => o.id === org1Id)
    expect(testOrg).toBeDefined()
    expect(testOrg?.id).toBeDefined()
    expect(testOrg?.name).toBeDefined()
    expect(testOrg?.domain).toBeDefined()
    expect(testOrg?.plan).toBeDefined()
    expect(testOrg?.settings).toBeDefined()
    expect(testOrg?.created_at).toBeDefined()
    expect(testOrg?.updated_at).toBeDefined()
  })
})

describe('listOrgWorkspaces', () => {
  beforeAll(async () => {
    wsA = await mkWorkspace({ orgId: org1Id })
    wsB = await mkWorkspace({ orgId: org1Id })
    wsC = await mkWorkspace({ orgId: org2Id })
  })

  it('lists workspaces bound to an organization', async () => {
    const workspaces = await listOrgWorkspaces(org1Id)
    const ids = workspaces.map(w => w.id)
    expect(ids).toContain(wsA)
    expect(ids).toContain(wsB)
    expect(ids).not.toContain(wsC)
  })

  it('lists workspaces ordered by name', async () => {
    const workspaces = await listOrgWorkspaces(org1Id)
    const names = workspaces.map(w => w.name)
    expect(names).toEqual([...names].sort())
  })

  it('returns empty array for org with no workspaces', async () => {
    const workspaces = await listOrgWorkspaces(randomUUID())
    expect(workspaces).toEqual([])
  })

  it('includes workspace name and org_id in results', async () => {
    const workspaces = await listOrgWorkspaces(org1Id)
    const ws = workspaces.find(w => w.id === wsA)
    expect(ws).toBeDefined()
    expect(ws?.name).toBeDefined()
    expect(ws?.org_id).toBe(org1Id)
  })
})

describe('addWorkspaceToOrg', () => {
  it('binds a workspace to an organization', async () => {
    const unbound = await mkWorkspace({ orgId: null })
    const success = await addWorkspaceToOrg(org1Id, unbound)
    expect(success).toBe(true)

    // Verify binding persisted
    const { rows } = await ctx.pool.query(
      `SELECT org_id FROM aaelink.workspaces WHERE id = $1`,
      [unbound]
    )
    expect(rows[0]?.org_id).toBe(org1Id)

    // Verify it shows in listOrgWorkspaces
    const workspaces = await listOrgWorkspaces(org1Id)
    expect(workspaces.map(w => w.id)).toContain(unbound)
  })

  it('updates existing binding when workspace already has an org', async () => {
    const ws = await mkWorkspace({ orgId: org2Id })
    const success = await addWorkspaceToOrg(org1Id, ws)
    expect(success).toBe(true)

    const { rows } = await ctx.pool.query(
      `SELECT org_id FROM aaelink.workspaces WHERE id = $1`,
      [ws]
    )
    expect(rows[0]?.org_id).toBe(org1Id)
  })

  it('returns false for non-existent workspace', async () => {
    const success = await addWorkspaceToOrg(org1Id, 'ws-does-not-exist')
    expect(success).toBe(false)
  })

  it('rejects when organization does not exist (FK violation)', async () => {
    const ws = await mkWorkspace({ orgId: null })
    // org_id FK is enforced: binding to a non-existent org raises
    // workspaces_org_id_fkey rather than silently affecting 0 rows.
    await expect(addWorkspaceToOrg(randomUUID(), ws)).rejects.toThrow()
  })
})

describe('removeWorkspaceFromOrg', () => {
  it('unbinds a workspace from its organization', async () => {
    const ws = await mkWorkspace({ orgId: org1Id })
    const success = await removeWorkspaceFromOrg(ws)
    expect(success).toBe(true)

    // Verify unbinding persisted
    const { rows } = await ctx.pool.query(
      `SELECT org_id FROM aaelink.workspaces WHERE id = $1`,
      [ws]
    )
    expect(rows[0]?.org_id).toBeNull()

    // Verify it no longer appears in listOrgWorkspaces
    const workspaces = await listOrgWorkspaces(org1Id)
    expect(workspaces.map(w => w.id)).not.toContain(ws)
  })

  it('returns false for non-existent workspace', async () => {
    const success = await removeWorkspaceFromOrg('ws-does-not-exist')
    expect(success).toBe(false)
  })

  it('is idempotent: can unbind multiple times', async () => {
    const ws = await mkWorkspace({ orgId: org1Id })
    const first = await removeWorkspaceFromOrg(ws)
    expect(first).toBe(true)

    // The UPDATE still matches the existing (already-unbound) workspace row,
    // so rowCount > 0 and the call reports true the second time too.
    const second = await removeWorkspaceFromOrg(ws)
    expect(second).toBe(true)
  })
})

describe('deleteOrganization', () => {
  it('deletes an organization by id', async () => {
    const toDelete = await createOrganization('Delete Test', 'delete-test.example.test', 'free')
    if (!toDelete) throw new Error('Failed to create org for deletion test')
    orgIds.push(toDelete.id)

    const success = await deleteOrganization(toDelete.id)
    expect(success).toBe(true)

    // Verify deletion persisted
    const org = await getOrganization(toDelete.id)
    expect(org).toBeNull()
  })

  it('cascades deletion to org_members when organization is deleted', async () => {
    const toDelete = await createOrganization('Cascade Test', 'cascade-test.example.test', 'pro')
    if (!toDelete) throw new Error('Failed to create org for cascade test')
    orgIds.push(toDelete.id)

    // Add a member
    await ctx.pool.query(
      `INSERT INTO aaelink.org_members (org_id, user_id, role) VALUES ($1, $2, 'org_owner')`,
      [toDelete.id, user.id]
    )

    // Verify member exists
    let { rows: members } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.org_members WHERE org_id = $1`,
      [toDelete.id]
    )
    expect(members.length).toBe(1)

    // Delete org
    const success = await deleteOrganization(toDelete.id)
    expect(success).toBe(true)

    // Verify members were cascaded
    members = (await ctx.pool.query(
      `SELECT 1 FROM aaelink.org_members WHERE org_id = $1`,
      [toDelete.id]
    )).rows
    expect(members.length).toBe(0)
  })

  it('returns false for non-existent organization', async () => {
    const success = await deleteOrganization(randomUUID())
    expect(success).toBe(false)
  })

  it('allows workspace to remain unbound when org is deleted', async () => {
    const toDelete = await createOrganization('Workspace Test', 'ws-test.example.test', 'free')
    if (!toDelete) throw new Error('Failed to create org for workspace test')
    orgIds.push(toDelete.id)

    const ws = await mkWorkspace({ orgId: toDelete.id })

    const success = await deleteOrganization(toDelete.id)
    expect(success).toBe(true)

    // workspaces.org_id FK is ON DELETE SET NULL: deleting the org leaves the
    // workspace row intact with org_id cleared to NULL (no cascade-delete).
    const { rows } = await ctx.pool.query(
      `SELECT org_id FROM aaelink.workspaces WHERE id = $1`,
      [ws]
    )
    expect(rows.length).toBe(1)
    expect(rows[0]?.org_id).toBeNull()
  })
})

describe('round-trip scenarios', () => {
  it('create -> get -> update -> list -> delete cycle', async () => {
    // Create
    const created = await createOrganization('Roundtrip Test', 'roundtrip.example.test', 'business_plus')
    expect(created).not.toBeNull()
    if (!created) throw new Error('Create failed')
    const id = created.id
    orgIds.push(id)

    // Get
    let org = await getOrganization(id)
    expect(org?.id).toBe(id)
    expect(org?.plan).toBe('business_plus')

    // Update
    const updated = await updateOrganization(id, { name: 'Roundtrip Updated', settings: { key: 'value' } })
    expect(updated?.name).toBe('Roundtrip Updated')
    expect(updated?.settings).toEqual({ key: 'value' })

    // Verify in list
    const all = await listOrganizations()
    expect(all.find(o => o.id === id)).toBeDefined()

    // Delete
    const deleted = await deleteOrganization(id)
    expect(deleted).toBe(true)
    org = await getOrganization(id)
    expect(org).toBeNull()
  })

  it('bind and unbind workspace across multiple orgs', async () => {
    const org1 = await createOrganization('Bind Test 1', 'bind-test-1.example.test', 'free')
    const org2 = await createOrganization('Bind Test 2', 'bind-test-2.example.test', 'free')
    if (!org1 || !org2) throw new Error('Failed to create orgs for bind test')
    orgIds.push(org1.id, org2.id)

    const ws = await mkWorkspace({ orgId: null })

    // Bind to org1
    let success = await addWorkspaceToOrg(org1.id, ws)
    expect(success).toBe(true)
    let list = await listOrgWorkspaces(org1.id)
    expect(list.map(w => w.id)).toContain(ws)

    // Move to org2
    success = await addWorkspaceToOrg(org2.id, ws)
    expect(success).toBe(true)
    list = await listOrgWorkspaces(org1.id)
    expect(list.map(w => w.id)).not.toContain(ws)
    list = await listOrgWorkspaces(org2.id)
    expect(list.map(w => w.id)).toContain(ws)

    // Unbind from org2
    success = await removeWorkspaceFromOrg(ws)
    expect(success).toBe(true)
    list = await listOrgWorkspaces(org2.id)
    expect(list.map(w => w.id)).not.toContain(ws)

    const { rows } = await ctx.pool.query(
      `SELECT org_id FROM aaelink.workspaces WHERE id = $1`,
      [ws]
    )
    expect(rows[0]?.org_id).toBeNull()
  })
})
