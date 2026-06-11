/**
 * Integration tests for IdP/SCIM group → role mappings (Admin 35 / Identity 13).
 *
 * Covers:
 *   - admin CRUD RBAC (401 / 403 / 200) on /api/admin/idp-role-mappings
 *   - the super_admin clamp at write time (role_not_grantable, 400)
 *   - applyGroupRoleMappings grants the mapped platform role on SSO-claim-style
 *     application, with highest-priority winning
 *   - the clamp blocks a super_admin mapping from ever granting that role
 *   - SCIM Groups membership change applies the mapped role to the added user
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID, createHash } from 'crypto'
import {
  createTestContext, createTestUser, asRequest, cleanupTestData,
  TestContext, TestUser,
} from '../helpers'
import { applyGroupRoleMappings } from '@/lib/auth/idpRoleMappings'

/** Poll audit_log until a row matching action + resource_kind lands (fire-and-forget). */
async function pollAuditRow(
  action: string,
  resourceKind: string,
  actorId: string,
  timeoutMs = 500,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { rows } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.audit_log
        WHERE action = $1 AND resource_kind = $2 AND actor_id = $3`,
      [action, resourceKind, actorId],
    )
    if (rows.length > 0) return true
    await new Promise(r => setTimeout(r, 25))
  }
  return false
}

let ctx: TestContext
let admin: TestUser
let employee: TestUser
const userIds: string[] = []
const mappingIds: string[] = []
const groupIds: string[] = []
const connIds: string[] = []

async function mkConnection(): Promise<string> {
  const id = randomUUID()
  const token = `scim_${randomUUID().replace(/-/g, '')}`
  const hash = createHash('sha256').update(token).digest('hex')
  await ctx.pool.query(
    `INSERT INTO aaelink.scim_connections (id, name, provider, bearer_token_hash, is_active, created_at, org_id)
     VALUES ($1, $2, 'azure_ad', $3, true, $4, NULL)`,
    [id, `conn-${id.slice(0, 6)}`, hash, Date.now()]
  )
  connIds.push(id)
  return token
}

async function seedMapping(
  groupPattern: string, targetKind: string, targetRole: string, priority: number
): Promise<string> {
  const id = randomUUID()
  const now = Date.now()
  await ctx.pool.query(
    `INSERT INTO aaelink.idp_group_role_mappings
       (id, org_id, workspace_id, group_pattern, target_kind, target_role, priority, is_active, created_at, updated_at)
     VALUES ($1, NULL, NULL, $2, $3, $4, $5, true, $6, $6)`,
    [id, groupPattern, targetKind, targetRole, priority, now]
  )
  mappingIds.push(id)
  return id
}

beforeAll(async () => {
  ctx = await createTestContext()
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  employee = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(admin.id, employee.id)
})

afterAll(async () => {
  if (mappingIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.idp_group_role_mappings WHERE id = ANY($1)`, [mappingIds]).catch(() => {})
  }
  if (groupIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.user_group_members WHERE group_id = ANY($1)`, [groupIds]).catch(() => {})
    await ctx.pool.query(`DELETE FROM aaelink.user_groups WHERE id = ANY($1)`, [groupIds]).catch(() => {})
  }
  if (connIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.scim_connections WHERE id = ANY($1)`, [connIds]).catch(() => {})
  }
  await ctx.pool.query(
    `DELETE FROM aaelink.audit_log WHERE resource_kind = 'idp_role_mapping' AND actor_id = $1`,
    [admin.id],
  ).catch(() => {})
  await cleanupTestData(ctx.pool, userIds)
  await ctx.cleanup()
})

describe('/api/admin/idp-role-mappings — RBAC', () => {
  it('401 without a session', async () => {
    const { GET } = await import('@/app/api/admin/idp-role-mappings/route')
    const res = await GET(asRequest('GET', '/api/admin/idp-role-mappings'))
    expect(res.status).toBe(401)
  })

  it('403 for a non-admin', async () => {
    const { GET } = await import('@/app/api/admin/idp-role-mappings/route')
    const res = await GET(asRequest('GET', '/api/admin/idp-role-mappings', { cookie: employee.sessionCookie }))
    expect(res.status).toBe(403)
  })

  it('200 for a platform admin', async () => {
    const { GET } = await import('@/app/api/admin/idp-role-mappings/route')
    const res = await GET(asRequest('GET', '/api/admin/idp-role-mappings', { cookie: admin.sessionCookie }))
    expect(res.status).toBe(200)
  })
})

describe('/api/admin/idp-role-mappings — CRUD + clamp', () => {
  it('creates a valid mapping (201)', async () => {
    const { POST } = await import('@/app/api/admin/idp-role-mappings/route')
    const res = await POST(asRequest('POST', '/api/admin/idp-role-mappings', {
      cookie: admin.sessionCookie,
      body: { group_pattern: 'it-admins', target_kind: 'platform_role', target_role: 'it_admin', priority: 10 },
    }))
    expect(res.status).toBe(201)
    const body = await res.json() as { mapping: { id: string } }
    mappingIds.push(body.mapping.id)
  })

  it('rejects a super_admin target with role_not_grantable (400)', async () => {
    const { POST } = await import('@/app/api/admin/idp-role-mappings/route')
    const res = await POST(asRequest('POST', '/api/admin/idp-role-mappings', {
      cookie: admin.sessionCookie,
      body: { group_pattern: 'owners', target_kind: 'platform_role', target_role: 'super_admin', priority: 99 },
    }))
    expect(res.status).toBe(400)
    expect((await res.json() as { error: string }).error).toBe('role_not_grantable')
  })

  it('rejects an invalid target_kind (400)', async () => {
    const { POST } = await import('@/app/api/admin/idp-role-mappings/route')
    const res = await POST(asRequest('POST', '/api/admin/idp-role-mappings', {
      cookie: admin.sessionCookie,
      body: { group_pattern: 'x', target_kind: 'nonsense', target_role: 'it_admin' },
    }))
    expect(res.status).toBe(400)
  })
})

describe('/api/admin/idp-role-mappings — audit_log regression', () => {
  /**
   * Verify that create, update, and delete each write an audit_log row with
   * resource_kind='idp_role_mapping' for the acting admin. This test catches the
   * pre-fix bug where the INSERT omitted id + created_at (both NOT NULL), causing
   * the DB to throw and the .catch() to swallow it silently.
   */
  it('create writes an audit_log row with action idp_role_mapping.create', async () => {
    const { POST } = await import('@/app/api/admin/idp-role-mappings/route')
    const res = await POST(asRequest('POST', '/api/admin/idp-role-mappings', {
      cookie: admin.sessionCookie,
      body: { group_pattern: 'audit-test-create', target_kind: 'platform_role', target_role: 'it_employee', priority: 1 },
    }))
    expect(res.status).toBe(201)
    const body = await res.json() as { mapping: { id: string } }
    mappingIds.push(body.mapping.id)

    const found = await pollAuditRow('idp_role_mapping.create', 'idp_role_mapping', admin.id)
    expect(found).toBe(true)
  })

  it('update writes an audit_log row with action idp_role_mapping.update', async () => {
    // Seed a mapping directly so this test does not depend on the create test.
    const id = await seedMapping('audit-test-update', 'platform_role', 'it_employee', 2)

    const { PATCH } = await import('@/app/api/admin/idp-role-mappings/route')
    const res = await PATCH(asRequest('PATCH', '/api/admin/idp-role-mappings', {
      cookie: admin.sessionCookie,
      body: { id, priority: 3 },
    }))
    expect(res.status).toBe(200)

    const found = await pollAuditRow('idp_role_mapping.update', 'idp_role_mapping', admin.id)
    expect(found).toBe(true)
  })

  it('delete writes an audit_log row with action idp_role_mapping.delete', async () => {
    const id = await seedMapping('audit-test-delete', 'platform_role', 'it_employee', 2)
    // Remove from mappingIds so afterAll does not try to delete an already-deleted row.
    const idx = mappingIds.indexOf(id)
    if (idx !== -1) mappingIds.splice(idx, 1)

    const { DELETE } = await import('@/app/api/admin/idp-role-mappings/route')
    const res = await DELETE(asRequest('DELETE', `/api/admin/idp-role-mappings?id=${id}`, {
      cookie: admin.sessionCookie,
    }))
    expect(res.status).toBe(200)

    const found = await pollAuditRow('idp_role_mapping.delete', 'idp_role_mapping', admin.id)
    expect(found).toBe(true)
  })
})

describe('applyGroupRoleMappings — grant + clamp + priority', () => {
  it('grants the mapped platform role on claim application', async () => {
    const u = await createTestUser(ctx.pool, { role: 'employee' })
    userIds.push(u.id)
    await seedMapping('engineers', 'platform_role', 'it_employee', 5)
    const out = await applyGroupRoleMappings(ctx.pool, u.id, ['engineers'])
    expect(out.platformRoleGranted).toBe('it_employee')
    const { rows } = await ctx.pool.query(`SELECT platform_role FROM aaelink.users WHERE id = $1`, [u.id])
    expect(rows[0].platform_role).toBe('it_employee')
  })

  it('highest-priority mapping wins', async () => {
    const u = await createTestUser(ctx.pool, { role: 'employee' })
    userIds.push(u.id)
    await seedMapping('p-low', 'platform_role', 'it_employee', 1)
    await seedMapping('p-high', 'platform_role', 'it_admin', 50)
    const out = await applyGroupRoleMappings(ctx.pool, u.id, ['p-low', 'p-high'])
    expect(out.platformRoleGranted).toBe('it_admin')
  })

  it('never auto-grants super_admin even with a matching seeded mapping', async () => {
    const u = await createTestUser(ctx.pool, { role: 'employee' })
    userIds.push(u.id)
    // Bypass the route clamp by inserting directly; resolver must still drop it.
    await seedMapping('would-be-admins', 'platform_role', 'super_admin', 100)
    const out = await applyGroupRoleMappings(ctx.pool, u.id, ['would-be-admins'])
    expect(out.platformRoleGranted).toBeNull()
    const { rows } = await ctx.pool.query(`SELECT platform_role FROM aaelink.users WHERE id = $1`, [u.id])
    expect(rows[0].platform_role).toBe('employee')
  })

  it('grant-only: never downgrades an already-higher platform role', async () => {
    const u = await createTestUser(ctx.pool, { role: 'it_admin' })
    userIds.push(u.id)
    await seedMapping('lowly', 'platform_role', 'employee', 5)
    const out = await applyGroupRoleMappings(ctx.pool, u.id, ['lowly'])
    expect(out.platformRoleGranted).toBeNull()
    const { rows } = await ctx.pool.query(`SELECT platform_role FROM aaelink.users WHERE id = $1`, [u.id])
    expect(rows[0].platform_role).toBe('it_admin')
  })
})

describe('SCIM Groups membership change applies mappings', () => {
  it('grants the mapped role when a user is added to a matching group', async () => {
    const token = await mkConnection()
    const u = await createTestUser(ctx.pool, { role: 'employee' })
    userIds.push(u.id)
    await seedMapping('scim-eng', 'platform_role', 'it_employee', 7)

    const { POST } = await import('@/app/api/scim/v2/Groups/route')
    const res = await POST(asRequest('POST', '/api/scim/v2/Groups', {
      headers: { authorization: `Bearer ${token}` },
      body: { displayName: 'scim-eng', members: [{ value: u.id }] },
    }))
    expect(res.status).toBe(201)
    const body = await res.json() as { id: string }
    groupIds.push(body.id)

    const { rows } = await ctx.pool.query(`SELECT platform_role FROM aaelink.users WHERE id = $1`, [u.id])
    expect(rows[0].platform_role).toBe('it_employee')
  })
})
