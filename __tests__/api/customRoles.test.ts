/**
 * Integration tests for lib/auth/customRoles.ts
 *
 * Exercises custom role management (create, list, update, assign, permissions aggregation)
 * at the lib layer against a live Postgres. The module exports functions that take a Pool
 * as the first argument and operate directly on custom_roles and role_assignments tables.
 *
 * Covers:
 *   - createRole: insert a custom role with permissions
 *   - listRoles: query all roles in a workspace
 *   - updateRole: modify role name, description, or permissions
 *   - assignRole: create a role assignment (user + scope)
 *   - listAssignments: filter assignments by workspace, user, or role
 *   - removeAssignment: delete an assignment
 *   - getUserPermissions: aggregate permissions from all user roles
 *   - deleteRole: remove a non-system role (rejection on system roles)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import {
  createRole,
  listRoles,
  updateRole,
  assignRole,
  listAssignments,
  removeAssignment,
  getUserPermissions,
  deleteRole,
  type Role,
  type RoleAssignment,
} from '@/lib/auth/customRoles'

let ctx: TestContext
let testUser: TestUser
let otherUser: TestUser

const userIds: string[] = []
const workspaceIds: string[] = []
const roleIds: string[] = []
const assignmentIds: string[] = []

/**
 * Create a workspace for testing.
 */
async function mkWorkspace(): Promise<string> {
  const id = `ws-${randomUUID().slice(0, 12)}`
  await ctx.pool.query(
    `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system, access_level)
     VALUES ($1, $1, $2, $3, $4, false, 'invite_only')`,
    [id, `WS ${id.slice(-6)}`, testUser.id, Date.now()]
  )
  workspaceIds.push(id)
  return id
}

let ws1: string
let ws2: string

beforeAll(async () => {
  ctx = await createTestContext()
  testUser = await createTestUser(ctx.pool, { role: 'employee' })
  otherUser = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(testUser.id, otherUser.id)

  ws1 = await mkWorkspace()
  ws2 = await mkWorkspace()
})

afterAll(async () => {
  // Delete in FK dependency order
  if (assignmentIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.role_assignments WHERE id = ANY($1)`, [assignmentIds])
  }
  if (roleIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.custom_roles WHERE id = ANY($1)`, [roleIds])
  }
  if (workspaceIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.workspaces WHERE id = ANY($1)`, [workspaceIds])
  }
  if (userIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
    await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE user_id = ANY($1)`, [userIds])
    await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
  }
})

describe('createRole', () => {
  it('creates a custom role with permissions and returns the role object', async () => {
    const permissions = ['channels:manage', 'users:invite']
    const role = await createRole(ctx.pool, ws1, 'Moderator', 'Can manage channels and invite users', permissions)

    expect(role.id).toBeDefined()
    expect(role.workspace_id).toBe(ws1)
    expect(role.name).toBe('Moderator')
    expect(role.description).toBe('Can manage channels and invite users')
    expect(role.permissions).toEqual(permissions)
    expect(role.is_system).toBe(false)
    expect(role.created_at).toBeDefined()
    expect(typeof role.created_at).toBe('number')

    roleIds.push(role.id)

    // Verify it was inserted in the DB
    const { rows } = await ctx.pool.query<Role>(
      `SELECT * FROM aaelink.custom_roles WHERE id = $1`,
      [role.id]
    )
    expect(rows.length).toBe(1)
    expect(rows[0].name).toBe('Moderator')
  })

  it('creates a role with empty permissions array', async () => {
    const role = await createRole(ctx.pool, ws1, 'Viewer', 'Read-only access', [])

    expect(role.permissions).toEqual([])
    expect(role.id).toBeDefined()
    roleIds.push(role.id)
  })

  it('creates multiple roles in the same workspace', async () => {
    const role1 = await createRole(ctx.pool, ws1, 'Admin', 'Full access', ['*:*'])
    const role2 = await createRole(ctx.pool, ws1, 'Editor', 'Edit content', ['content:write'])

    expect(role1.id).not.toBe(role2.id)
    expect(role1.workspace_id).toBe(ws1)
    expect(role2.workspace_id).toBe(ws1)

    roleIds.push(role1.id, role2.id)

    const roles = await listRoles(ctx.pool, ws1)
    const names = roles.map(r => r.name).sort()
    expect(names).toContain('Admin')
    expect(names).toContain('Editor')
  })

  it('creates roles with the same name in different workspaces', async () => {
    const role1 = await createRole(ctx.pool, ws1, 'Lead', 'Team lead', ['team:manage'])
    const role2 = await createRole(ctx.pool, ws2, 'Lead', 'Team lead in ws2', ['team:manage'])

    expect(role1.id).not.toBe(role2.id)
    expect(role1.workspace_id).toBe(ws1)
    expect(role2.workspace_id).toBe(ws2)

    roleIds.push(role1.id, role2.id)
  })
})

describe('listRoles', () => {
  it('returns all roles for a workspace ordered by is_system DESC, name ASC', async () => {
    // Use a fresh workspace so roles created in other `it` blocks don't leak in.
    const orderWs = await mkWorkspace()
    const r1 = await createRole(ctx.pool, orderWs, 'ZuluRole', 'Last alphabetically', ['a:b'])
    const r2 = await createRole(ctx.pool, orderWs, 'AlphaRole', 'First alphabetically', ['c:d'])

    roleIds.push(r1.id, r2.id)

    const roles = await listRoles(ctx.pool, orderWs)
    const names = roles.map(r => r.name)

    // Non-system roles sorted by name
    const customNames = names.filter(n => n !== 'system')
    expect(customNames[0]).toBe('AlphaRole')
    expect(customNames).toContain('ZuluRole')
  })

  it('returns empty list for workspace with no roles', async () => {
    const emptyWs = `ws-${randomUUID().slice(0, 12)}`
    await ctx.pool.query(
      `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system)
       VALUES ($1, $1, $2, $3, $4, false)`,
      [emptyWs, `WS ${emptyWs.slice(-6)}`, testUser.id, Date.now()]
    )
    workspaceIds.push(emptyWs)

    const roles = await listRoles(ctx.pool, emptyWs)
    expect(roles).toEqual([])
  })

  it('parses JSON permissions array from the database', async () => {
    const permissions = ['audit:read', 'users:list', 'channels:archive']
    const role = await createRole(ctx.pool, ws1, 'Auditor', 'Audit access', permissions)

    roleIds.push(role.id)

    const roles = await listRoles(ctx.pool, ws1)
    const auditor = roles.find(r => r.id === role.id)

    expect(auditor).toBeDefined()
    expect(auditor!.permissions).toEqual(permissions)
    expect(Array.isArray(auditor!.permissions)).toBe(true)
  })
})

describe('updateRole', () => {
  it('updates role name', async () => {
    const role = await createRole(ctx.pool, ws1, 'OldName', 'Description', ['perm:1'])
    roleIds.push(role.id)

    await updateRole(ctx.pool, role.id, { name: 'NewName' })

    const updated = await listRoles(ctx.pool, ws1)
    const found = updated.find(r => r.id === role.id)

    expect(found!.name).toBe('NewName')
    expect(found!.description).toBe('Description')
    expect(found!.permissions).toEqual(['perm:1'])
  })

  it('updates role description', async () => {
    const role = await createRole(ctx.pool, ws1, 'Role1', 'Old desc', ['perm:1'])
    roleIds.push(role.id)

    await updateRole(ctx.pool, role.id, { description: 'New description' })

    const updated = await listRoles(ctx.pool, ws1)
    const found = updated.find(r => r.id === role.id)

    expect(found!.description).toBe('New description')
  })

  it('updates role permissions', async () => {
    const role = await createRole(ctx.pool, ws1, 'Role2', 'Test', ['old:perm'])
    roleIds.push(role.id)

    const newPerms = ['new:perm1', 'new:perm2']
    await updateRole(ctx.pool, role.id, { permissions: newPerms })

    const updated = await listRoles(ctx.pool, ws1)
    const found = updated.find(r => r.id === role.id)

    expect(found!.permissions).toEqual(newPerms)
  })

  it('updates multiple fields at once', async () => {
    const role = await createRole(ctx.pool, ws1, 'Multi', 'Original', ['original:perm'])
    roleIds.push(role.id)

    await updateRole(ctx.pool, role.id, {
      name: 'MultiUpdated',
      description: 'Updated description',
      permissions: ['updated:perm1', 'updated:perm2'],
    })

    const updated = await listRoles(ctx.pool, ws1)
    const found = updated.find(r => r.id === role.id)

    expect(found!.name).toBe('MultiUpdated')
    expect(found!.description).toBe('Updated description')
    expect(found!.permissions).toEqual(['updated:perm1', 'updated:perm2'])
  })

  it('is a no-op when no updates provided', async () => {
    const role = await createRole(ctx.pool, ws1, 'NoChange', 'Stay same', ['stay:same'])
    roleIds.push(role.id)

    await updateRole(ctx.pool, role.id, {})

    const updated = await listRoles(ctx.pool, ws1)
    const found = updated.find(r => r.id === role.id)

    expect(found!.name).toBe('NoChange')
    expect(found!.description).toBe('Stay same')
    expect(found!.permissions).toEqual(['stay:same'])
  })
})

describe('assignRole', () => {
  it('creates a role assignment and returns the assignment object', async () => {
    const role = await createRole(ctx.pool, ws1, 'AssignableRole', '', ['perm:1'])
    roleIds.push(role.id)

    const assignment = await assignRole(
      ctx.pool,
      role.id,
      testUser.id,
      ws1,
      'workspace',
      '',
      testUser.id
    )

    expect(assignment.id).toBeDefined()
    expect(assignment.role_id).toBe(role.id)
    expect(assignment.user_id).toBe(testUser.id)
    expect(assignment.workspace_id).toBe(ws1)
    expect(assignment.scope).toBe('workspace')
    expect(assignment.scope_id).toBe('')
    expect(assignment.assigned_by).toBe(testUser.id)
    expect(assignment.assigned_at).toBeDefined()
    expect(typeof assignment.assigned_at).toBe('number')

    assignmentIds.push(assignment.id)

    // Verify it was inserted in the DB
    const { rows } = await ctx.pool.query<RoleAssignment>(
      `SELECT * FROM aaelink.role_assignments WHERE id = $1`,
      [assignment.id]
    )
    expect(rows.length).toBe(1)
    expect(rows[0].user_id).toBe(testUser.id)
  })

  it('creates a scoped assignment (channel scope)', async () => {
    const role = await createRole(ctx.pool, ws1, 'ChannelRole', '', ['channel:manage'])
    roleIds.push(role.id)

    const channelId = `ch-${randomUUID().slice(0, 12)}`
    const assignment = await assignRole(
      ctx.pool,
      role.id,
      testUser.id,
      ws1,
      'channel',
      channelId,
      testUser.id
    )

    expect(assignment.scope).toBe('channel')
    expect(assignment.scope_id).toBe(channelId)

    assignmentIds.push(assignment.id)
  })

  it('allows multiple role assignments to the same user in the same workspace', async () => {
    const role1 = await createRole(ctx.pool, ws1, 'Role1ForMulti', '', ['perm:1'])
    const role2 = await createRole(ctx.pool, ws1, 'Role2ForMulti', '', ['perm:2'])
    roleIds.push(role1.id, role2.id)

    const assign1 = await assignRole(ctx.pool, role1.id, testUser.id, ws1, 'workspace', '', testUser.id)
    const assign2 = await assignRole(ctx.pool, role2.id, testUser.id, ws1, 'workspace', '', testUser.id)

    expect(assign1.id).not.toBe(assign2.id)

    assignmentIds.push(assign1.id, assign2.id)
  })

  it('handles ON CONFLICT DO NOTHING for duplicate assignments', async () => {
    const role = await createRole(ctx.pool, ws1, 'DuplicateTestRole', '', ['perm:1'])
    roleIds.push(role.id)

    const assign1 = await assignRole(ctx.pool, role.id, testUser.id, ws1, 'workspace', '', testUser.id)
    assignmentIds.push(assign1.id)

    // Try to assign the same role to the same user (should succeed silently)
    const assign2 = await assignRole(ctx.pool, role.id, testUser.id, ws1, 'workspace', '', testUser.id)

    // Return value is still the expected shape
    expect(assign2.role_id).toBe(role.id)
    expect(assign2.user_id).toBe(testUser.id)

    // But only one row exists in the DB
    const { rows } = await ctx.pool.query(
      `SELECT id FROM aaelink.role_assignments WHERE role_id = $1 AND user_id = $2 AND workspace_id = $3`,
      [role.id, testUser.id, ws1]
    )
    expect(rows.length).toBe(1)
  })

  it('assigns the same role to different users', async () => {
    const role = await createRole(ctx.pool, ws1, 'SharedRole', '', ['perm:shared'])
    roleIds.push(role.id)

    const assign1 = await assignRole(ctx.pool, role.id, testUser.id, ws1, 'workspace', '', testUser.id)
    const assign2 = await assignRole(ctx.pool, role.id, otherUser.id, ws1, 'workspace', '', testUser.id)

    expect(assign1.user_id).toBe(testUser.id)
    expect(assign2.user_id).toBe(otherUser.id)

    assignmentIds.push(assign1.id, assign2.id)
  })
})

describe('listAssignments', () => {
  it('returns all assignments for a workspace', async () => {
    const role1 = await createRole(ctx.pool, ws1, 'ListRole1', '', ['perm:1'])
    const role2 = await createRole(ctx.pool, ws1, 'ListRole2', '', ['perm:2'])
    roleIds.push(role1.id, role2.id)

    const assign1 = await assignRole(ctx.pool, role1.id, testUser.id, ws1, 'workspace', '', testUser.id)
    const assign2 = await assignRole(ctx.pool, role2.id, testUser.id, ws1, 'workspace', '', testUser.id)

    assignmentIds.push(assign1.id, assign2.id)

    const assignments = await listAssignments(ctx.pool, ws1)

    const ids = assignments.map(a => a.id)
    expect(ids).toContain(assign1.id)
    expect(ids).toContain(assign2.id)
  })

  it('filters assignments by userId', async () => {
    const role = await createRole(ctx.pool, ws1, 'FilterByUserRole', '', ['perm:1'])
    roleIds.push(role.id)

    const assign1 = await assignRole(ctx.pool, role.id, testUser.id, ws1, 'workspace', '', testUser.id)
    const assign2 = await assignRole(ctx.pool, role.id, otherUser.id, ws1, 'workspace', '', testUser.id)

    assignmentIds.push(assign1.id, assign2.id)

    const userAssignments = await listAssignments(ctx.pool, ws1, { userId: testUser.id })

    expect(userAssignments.length).toBeGreaterThanOrEqual(1)
    expect(userAssignments.every(a => a.user_id === testUser.id)).toBe(true)
  })

  it('filters assignments by roleId', async () => {
    const role1 = await createRole(ctx.pool, ws1, 'FilterByRoleRole1', '', ['perm:1'])
    const role2 = await createRole(ctx.pool, ws1, 'FilterByRoleRole2', '', ['perm:2'])
    roleIds.push(role1.id, role2.id)

    const assign1 = await assignRole(ctx.pool, role1.id, testUser.id, ws1, 'workspace', '', testUser.id)
    const assign2 = await assignRole(ctx.pool, role2.id, testUser.id, ws1, 'workspace', '', testUser.id)

    assignmentIds.push(assign1.id, assign2.id)

    const role1Assignments = await listAssignments(ctx.pool, ws1, { roleId: role1.id })

    expect(role1Assignments.length).toBeGreaterThanOrEqual(1)
    expect(role1Assignments.every(a => a.role_id === role1.id)).toBe(true)
    expect(role1Assignments.some(a => a.role_id === role2.id)).toBe(false)
  })

  it('filters by both userId and roleId', async () => {
    const role = await createRole(ctx.pool, ws1, 'FilterBothRole', '', ['perm:1'])
    roleIds.push(role.id)

    const assign1 = await assignRole(ctx.pool, role.id, testUser.id, ws1, 'workspace', '', testUser.id)
    const assign2 = await assignRole(ctx.pool, role.id, otherUser.id, ws1, 'workspace', '', testUser.id)

    assignmentIds.push(assign1.id, assign2.id)

    const filtered = await listAssignments(ctx.pool, ws1, { userId: testUser.id, roleId: role.id })

    expect(filtered.length).toBeGreaterThanOrEqual(1)
    expect(filtered.every(a => a.user_id === testUser.id && a.role_id === role.id)).toBe(true)
  })

  it('returns assignments ordered by assigned_at DESC', async () => {
    const role = await createRole(ctx.pool, ws1, 'OrderTestRole', '', ['perm:1'])
    roleIds.push(role.id)

    const assign1 = await assignRole(ctx.pool, role.id, testUser.id, ws1, 'workspace', '', testUser.id)
    await new Promise(resolve => setTimeout(resolve, 10))
    const assign2 = await assignRole(ctx.pool, role.id, otherUser.id, ws1, 'workspace', '', testUser.id)

    assignmentIds.push(assign1.id, assign2.id)

    const assignments = await listAssignments(ctx.pool, ws1, { roleId: role.id })
    const filtered = assignments.filter(a => [assign1.id, assign2.id].includes(a.id))

    if (filtered.length >= 2) {
      // assigned_at is BIGINT; node-pg returns it as a string, so coerce before comparing.
      expect(Number(filtered[0].assigned_at)).toBeGreaterThanOrEqual(Number(filtered[1].assigned_at))
    }
  })
})

describe('removeAssignment', () => {
  it('deletes a role assignment', async () => {
    const role = await createRole(ctx.pool, ws1, 'RemoveTestRole', '', ['perm:1'])
    roleIds.push(role.id)

    const assignment = await assignRole(ctx.pool, role.id, testUser.id, ws1, 'workspace', '', testUser.id)
    assignmentIds.push(assignment.id)

    // Verify it exists
    const { rows: before } = await ctx.pool.query(
      `SELECT id FROM aaelink.role_assignments WHERE id = $1`,
      [assignment.id]
    )
    expect(before.length).toBe(1)

    // Remove it
    await removeAssignment(ctx.pool, assignment.id)

    // Verify it's gone
    const { rows: after } = await ctx.pool.query(
      `SELECT id FROM aaelink.role_assignments WHERE id = $1`,
      [assignment.id]
    )
    expect(after.length).toBe(0)
  })

  it('is idempotent (removing non-existent assignment)', async () => {
    const fakeId = randomUUID()

    // Should not throw
    await removeAssignment(ctx.pool, fakeId)

    // Verify still nothing
    const { rows } = await ctx.pool.query(
      `SELECT id FROM aaelink.role_assignments WHERE id = $1`,
      [fakeId]
    )
    expect(rows.length).toBe(0)
  })

  it('removes one assignment without affecting others', async () => {
    const role = await createRole(ctx.pool, ws1, 'MultiRemoveRole', '', ['perm:1'])
    roleIds.push(role.id)

    const assign1 = await assignRole(ctx.pool, role.id, testUser.id, ws1, 'workspace', '', testUser.id)
    const assign2 = await assignRole(ctx.pool, role.id, otherUser.id, ws1, 'workspace', '', testUser.id)

    assignmentIds.push(assign1.id, assign2.id)

    // Remove first assignment
    await removeAssignment(ctx.pool, assign1.id)

    // Second should still exist
    const { rows } = await ctx.pool.query(
      `SELECT id FROM aaelink.role_assignments WHERE id = $1`,
      [assign2.id]
    )
    expect(rows.length).toBe(1)
  })
})

describe('getUserPermissions', () => {
  it('returns aggregated permissions from all roles assigned to a user', async () => {
    // Fresh workspace so assignments from other `it` blocks don't add extra perms.
    const aggWs = await mkWorkspace()
    const role1 = await createRole(ctx.pool, aggWs, 'PermRole1', '', ['perm:read', 'perm:list'])
    const role2 = await createRole(ctx.pool, aggWs, 'PermRole2', '', ['perm:write', 'perm:delete'])
    roleIds.push(role1.id, role2.id)

    const assign1 = await assignRole(ctx.pool, role1.id, testUser.id, aggWs, 'workspace', '', testUser.id)
    const assign2 = await assignRole(ctx.pool, role2.id, testUser.id, aggWs, 'workspace', '', testUser.id)

    assignmentIds.push(assign1.id, assign2.id)

    const perms = await getUserPermissions(ctx.pool, testUser.id, aggWs)

    expect(perms.sort()).toEqual(['perm:delete', 'perm:list', 'perm:read', 'perm:write'].sort())
  })

  it('deduplicates permissions across multiple roles', async () => {
    // Fresh workspace so assignments from other `it` blocks don't add extra perms.
    const dupWs = await mkWorkspace()
    const role1 = await createRole(ctx.pool, dupWs, 'DupRole1', '', ['perm:shared', 'perm:unique1'])
    const role2 = await createRole(ctx.pool, dupWs, 'DupRole2', '', ['perm:shared', 'perm:unique2'])
    roleIds.push(role1.id, role2.id)

    const assign1 = await assignRole(ctx.pool, role1.id, testUser.id, dupWs, 'workspace', '', testUser.id)
    const assign2 = await assignRole(ctx.pool, role2.id, testUser.id, dupWs, 'workspace', '', testUser.id)

    assignmentIds.push(assign1.id, assign2.id)

    const perms = await getUserPermissions(ctx.pool, testUser.id, dupWs)

    expect(perms.sort()).toEqual(['perm:shared', 'perm:unique1', 'perm:unique2'].sort())
    expect(perms.filter(p => p === 'perm:shared').length).toBe(1)
  })

  it('returns empty array for user with no role assignments', async () => {
    const perms = await getUserPermissions(ctx.pool, otherUser.id, ws2)

    expect(perms).toEqual([])
  })

  it('returns permissions only for the specified workspace', async () => {
    const role1 = await createRole(ctx.pool, ws1, 'Ws1Role', '', ['ws1:perm'])
    const role2 = await createRole(ctx.pool, ws2, 'Ws2Role', '', ['ws2:perm'])
    roleIds.push(role1.id, role2.id)

    const assign1 = await assignRole(ctx.pool, role1.id, testUser.id, ws1, 'workspace', '', testUser.id)
    const assign2 = await assignRole(ctx.pool, role2.id, testUser.id, ws2, 'workspace', '', testUser.id)

    assignmentIds.push(assign1.id, assign2.id)

    const permsWs1 = await getUserPermissions(ctx.pool, testUser.id, ws1)
    const permsWs2 = await getUserPermissions(ctx.pool, testUser.id, ws2)

    expect(permsWs1).toContain('ws1:perm')
    expect(permsWs1).not.toContain('ws2:perm')

    expect(permsWs2).toContain('ws2:perm')
    expect(permsWs2).not.toContain('ws1:perm')
  })

  it('handles JSON parsing of permissions arrays', async () => {
    const role = await createRole(ctx.pool, ws1, 'JsonRole', '', ['json:perm1', 'json:perm2'])
    roleIds.push(role.id)

    const assignment = await assignRole(ctx.pool, role.id, testUser.id, ws1, 'workspace', '', testUser.id)
    assignmentIds.push(assignment.id)

    const perms = await getUserPermissions(ctx.pool, testUser.id, ws1)

    expect(perms).toContain('json:perm1')
    expect(perms).toContain('json:perm2')
  })
})

describe('deleteRole', () => {
  it('deletes a non-system custom role', async () => {
    const role = await createRole(ctx.pool, ws1, 'DeletableRole', 'For deletion', ['perm:1'])
    roleIds.push(role.id)

    const result = await deleteRole(ctx.pool, role.id)

    expect(result).toBe(true)

    // Verify it's gone from DB
    const { rows } = await ctx.pool.query(
      `SELECT id FROM aaelink.custom_roles WHERE id = $1`,
      [role.id]
    )
    expect(rows.length).toBe(0)
  })

  it('returns false for non-existent role', async () => {
    const fakeId = randomUUID()

    const result = await deleteRole(ctx.pool, fakeId)

    expect(result).toBe(false)
  })

  it('returns false for system roles (is_system = true)', async () => {
    // Manually create a system role for testing rejection
    const sysRoleId = randomUUID()
    await ctx.pool.query(
      `INSERT INTO aaelink.custom_roles (id, workspace_id, name, description, permissions, is_system, created_at)
       VALUES ($1, $2, $3, $4, $5, true, $6)`,
      [sysRoleId, ws1, 'SystemRole', '', '{}', Date.now()]
    )

    const result = await deleteRole(ctx.pool, sysRoleId)

    expect(result).toBe(false)

    // Verify it still exists
    const { rows } = await ctx.pool.query(
      `SELECT id FROM aaelink.custom_roles WHERE id = $1`,
      [sysRoleId]
    )
    expect(rows.length).toBe(1)

    // Clean up
    await ctx.pool.query(`DELETE FROM aaelink.custom_roles WHERE id = $1`, [sysRoleId])
  })

  it('returns false for built-in role names (owner, admin, member, guest)', async () => {
    // Test with a non-system role but with a built-in name
    const roleId = randomUUID()
    await ctx.pool.query(
      `INSERT INTO aaelink.custom_roles (id, workspace_id, name, description, permissions, is_system, created_at)
       VALUES ($1, $2, $3, $4, $5, false, $6)`,
      [roleId, ws1, 'owner', 'Custom owner role', '{}', Date.now()]
    )

    const result = await deleteRole(ctx.pool, roleId)

    expect(result).toBe(false)

    // Verify it still exists
    const { rows } = await ctx.pool.query(
      `SELECT id FROM aaelink.custom_roles WHERE id = $1`,
      [roleId]
    )
    expect(rows.length).toBe(1)

    // Clean up
    await ctx.pool.query(`DELETE FROM aaelink.custom_roles WHERE id = $1`, [roleId])
  })

  it('cascades delete to role_assignments', async () => {
    const role = await createRole(ctx.pool, ws1, 'DeleteWithAssignRole', '', ['perm:1'])
    roleIds.push(role.id)

    const assignment = await assignRole(ctx.pool, role.id, testUser.id, ws1, 'workspace', '', testUser.id)
    assignmentIds.push(assignment.id)

    // Verify assignment exists
    const { rows: assignBefore } = await ctx.pool.query(
      `SELECT id FROM aaelink.role_assignments WHERE id = $1`,
      [assignment.id]
    )
    expect(assignBefore.length).toBe(1)

    // Delete the role
    const result = await deleteRole(ctx.pool, role.id)

    expect(result).toBe(true)

    // Verify assignment was deleted (cascade)
    const { rows: assignAfter } = await ctx.pool.query(
      `SELECT id FROM aaelink.role_assignments WHERE id = $1`,
      [assignment.id]
    )
    expect(assignAfter.length).toBe(0)
  })

  it('deletes multiple roles independently', async () => {
    const role1 = await createRole(ctx.pool, ws1, 'DeleteRole1', '', ['perm:1'])
    const role2 = await createRole(ctx.pool, ws1, 'DeleteRole2', '', ['perm:2'])
    roleIds.push(role1.id, role2.id)

    const result1 = await deleteRole(ctx.pool, role1.id)
    const result2 = await deleteRole(ctx.pool, role2.id)

    expect(result1).toBe(true)
    expect(result2).toBe(true)

    // Verify both are gone
    const { rows } = await ctx.pool.query(
      `SELECT id FROM aaelink.custom_roles WHERE id = ANY($1)`,
      [[role1.id, role2.id]]
    )
    expect(rows.length).toBe(0)
  })
})

describe('integration: full lifecycle', () => {
  it('creates a role, assigns it, queries permissions, updates, and deletes', async () => {
    // Create role
    const perms1 = ['read:data', 'list:items']
    const role = await createRole(ctx.pool, ws1, 'LifecycleRole', 'For testing', perms1)
    roleIds.push(role.id)

    expect(role.permissions).toEqual(perms1)

    // List roles to verify it exists
    const rolesBefore = await listRoles(ctx.pool, ws1)
    expect(rolesBefore.find(r => r.id === role.id)).toBeDefined()

    // Assign the role
    const assignment = await assignRole(ctx.pool, role.id, testUser.id, ws1, 'workspace', '', testUser.id)
    assignmentIds.push(assignment.id)

    // Get user permissions
    const permsBefore = await getUserPermissions(ctx.pool, testUser.id, ws1)
    expect(permsBefore).toEqual(expect.arrayContaining(perms1))

    // Update role with new permissions
    const perms2 = ['read:data', 'write:data']
    await updateRole(ctx.pool, role.id, { permissions: perms2 })

    // Permissions should reflect update
    const permsAfter = await getUserPermissions(ctx.pool, testUser.id, ws1)
    expect(permsAfter).toEqual(expect.arrayContaining(perms2))
    expect(permsAfter).not.toContain('list:items')

    // List assignments
    const assignments = await listAssignments(ctx.pool, ws1, { roleId: role.id })
    expect(assignments.map(a => a.id)).toContain(assignment.id)

    // Remove assignment
    await removeAssignment(ctx.pool, assignment.id)

    // User should have no permissions from this role
    const permsAfterRemoval = await getUserPermissions(ctx.pool, testUser.id, ws1)
    expect(permsAfterRemoval).not.toContain('read:data')
    expect(permsAfterRemoval).not.toContain('write:data')

    // Delete role
    const deleted = await deleteRole(ctx.pool, role.id)
    expect(deleted).toBe(true)

    // Role should no longer appear in list
    const rolesAfter = await listRoles(ctx.pool, ws1)
    expect(rolesAfter.find(r => r.id === role.id)).toBeUndefined()
  })
})
