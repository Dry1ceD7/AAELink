/**
 * Integration tests for organization policy management.
 *
 * Exercises the policy functions at the lib layer (lib/enterprise/orgPolicies.ts)
 * against a live Postgres. Covers all exported functions:
 *   - setOrgPolicy: create and upsert org-level policies
 *   - getOrgPolicy: fetch a specific org policy
 *   - listOrgPolicies: list all policies for an org
 *   - getEffectivePolicy: resolve workspace-inherited org policy
 *   - deleteOrgPolicy: remove a policy
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import {
  setOrgPolicy,
  getOrgPolicy,
  listOrgPolicies,
  getEffectivePolicy,
  deleteOrgPolicy,
  type PolicyType,
  type OrgPolicy,
} from '@/lib/enterprise/orgPolicies'

let ctx: TestContext
let user: TestUser
const userIds: string[] = []
const orgIds: string[] = []
const wsIds: string[] = []

async function mkOrg(): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.organizations (id, name, domain) VALUES ($1, $2, $3)`,
    [id, `TestOrg ${id.slice(0, 6)}`, `${id.slice(0, 8)}.test`]
  )
  orgIds.push(id)
  return id
}

async function mkWorkspace(orgId: string | null): Promise<string> {
  const id = `ws-${randomUUID().slice(0, 12)}`
  await ctx.pool.query(
    `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system, org_id, access_level)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, `TestWS-${id.slice(-6)}`, `Test WS`, user.id, Date.now(), false, orgId, 'invite_only']
  )
  wsIds.push(id)
  return id
}

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(user.id)
})

afterAll(async () => {
  if (wsIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.workspaces WHERE id = ANY($1)`, [wsIds])
  }
  if (orgIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.organizations WHERE id = ANY($1)`, [orgIds])
  }
  if (userIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE user_id = ANY($1)`, [userIds])
    await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
    await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
  }
})

describe('setOrgPolicy', () => {
  it('creates a new org policy with default enforced=false', async () => {
    const orgId = await mkOrg()
    const config = { days: 90 }
    const policy = await setOrgPolicy(orgId, 'retention', config)

    expect(policy).not.toBeNull()
    expect(policy!.id).toBeDefined()
    expect(policy!.org_id).toBe(orgId)
    expect(policy!.policy_type).toBe('retention')
    expect(policy!.config).toEqual(config)
    expect(policy!.enforced).toBe(false)
    expect(policy!.created_at).toBeDefined()
    expect(policy!.updated_at).toBeDefined()
  })

  it('creates a policy with enforced=true', async () => {
    const orgId = await mkOrg()
    const config = { enabled: true }
    const policy = await setOrgPolicy(orgId, 'sso', config, true)

    expect(policy).not.toBeNull()
    expect(policy!.enforced).toBe(true)
    expect(policy!.policy_type).toBe('sso')
  })

  it('upserts an existing policy, updating config and enforced', async () => {
    const orgId = await mkOrg()
    const config1 = { days: 30 }
    const policy1 = await setOrgPolicy(orgId, 'retention', config1, false)
    expect(policy1!.id).toBeDefined()

    const config2 = { days: 60 }
    const policy2 = await setOrgPolicy(orgId, 'retention', config2, true)

    expect(policy2!.id).toBe(policy1!.id) // same policy id
    expect(policy2!.config).toEqual(config2)
    expect(policy2!.enforced).toBe(true)
    // >= tolerates an upsert landing in the same millisecond as the create.
    expect(new Date(policy2!.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(policy1!.updated_at).getTime()
    )
  })

  it('handles all policy types', async () => {
    const orgId = await mkOrg()
    const types: PolicyType[] = ['retention', 'dlp', 'sso', 'session', 'ip_access', 'data_residency']

    for (const policyType of types) {
      const policy = await setOrgPolicy(orgId, policyType, { test: true }, false)
      expect(policy).not.toBeNull()
      expect(policy!.policy_type).toBe(policyType)
    }
  })

  it('handles complex JSON config', async () => {
    const orgId = await mkOrg()
    const config = {
      rules: [
        { pattern: '.*credit.*', action: 'block' },
        { pattern: '.*ssn.*', action: 'redact' },
      ],
      enabled: true,
      severity: 'high',
    }
    const policy = await setOrgPolicy(orgId, 'dlp', config)

    expect(policy!.config).toEqual(config)
  })
})

describe('getOrgPolicy', () => {
  it('retrieves an existing policy by org and type', async () => {
    const orgId = await mkOrg()
    const config = { days: 90 }
    const created = await setOrgPolicy(orgId, 'retention', config)

    const fetched = await getOrgPolicy(orgId, 'retention')
    expect(fetched).not.toBeNull()
    expect(fetched!.id).toBe(created!.id)
    expect(fetched!.config).toEqual(config)
  })

  it('returns null for a non-existent policy', async () => {
    const orgId = await mkOrg()
    const policy = await getOrgPolicy(orgId, 'sso')
    expect(policy).toBeNull()
  })

  it('returns null for a policy in a non-existent org', async () => {
    const fakeOrgId = randomUUID()
    const policy = await getOrgPolicy(fakeOrgId, 'retention')
    expect(policy).toBeNull()
  })

  it('returns correct type shape for stored policy', async () => {
    const orgId = await mkOrg()
    const config = { test: 'value' }
    await setOrgPolicy(orgId, 'ip_access', config)

    const policy = await getOrgPolicy(orgId, 'ip_access')
    expect(typeof policy!.id).toBe('string')
    expect(typeof policy!.org_id).toBe('string')
    expect(typeof policy!.policy_type).toBe('string')
    expect(typeof policy!.config).toBe('object')
    expect(typeof policy!.enforced).toBe('boolean')
    expect(policy!.created_at).toBeDefined()
    expect(policy!.updated_at).toBeDefined()
  })
})

describe('listOrgPolicies', () => {
  it('lists all policies for an org, ordered by policy_type', async () => {
    const orgId = await mkOrg()

    await setOrgPolicy(orgId, 'sso', { enabled: true })
    await setOrgPolicy(orgId, 'retention', { days: 30 })
    await setOrgPolicy(orgId, 'dlp', { rules: [] })

    const policies = await listOrgPolicies(orgId)
    expect(policies.length).toBe(3)

    const types = policies.map(p => p.policy_type)
    expect(types).toEqual(['dlp', 'retention', 'sso']) // alphabetically sorted
  })

  it('returns empty array for org with no policies', async () => {
    const orgId = await mkOrg()
    const policies = await listOrgPolicies(orgId)
    expect(policies).toEqual([])
  })

  it('returns empty array for non-existent org', async () => {
    const fakeOrgId = randomUUID()
    const policies = await listOrgPolicies(fakeOrgId)
    expect(policies).toEqual([])
  })

  it('each returned policy has correct shape', async () => {
    const orgId = await mkOrg()
    await setOrgPolicy(orgId, 'session', { timeout: 3600 })
    await setOrgPolicy(orgId, 'ip_access', { whitelist: ['10.0.0.0/8'] })

    const policies = await listOrgPolicies(orgId)
    expect(policies.length).toBe(2)

    for (const policy of policies) {
      expect(policy.id).toBeDefined()
      expect(policy.org_id).toBe(orgId)
      expect(['session', 'ip_access']).toContain(policy.policy_type)
      expect(typeof policy.config).toBe('object')
      expect(typeof policy.enforced).toBe('boolean')
      expect(policy.created_at).toBeDefined()
      expect(policy.updated_at).toBeDefined()
    }
  })
})

describe('getEffectivePolicy', () => {
  it('returns null for a workspace with no org', async () => {
    const wsId = await mkWorkspace(null)
    const policy = await getEffectivePolicy(wsId, 'retention')
    expect(policy).toBeNull()
  })

  it('returns null when org has no policy of that type', async () => {
    const orgId = await mkOrg()
    const wsId = await mkWorkspace(orgId)

    const policy = await getEffectivePolicy(wsId, 'sso')
    expect(policy).toBeNull()
  })

  it('returns the org policy when it exists and workspace is in org', async () => {
    const orgId = await mkOrg()
    const wsId = await mkWorkspace(orgId)
    const config = { days: 45 }
    const orgPolicy = await setOrgPolicy(orgId, 'retention', config)

    const effective = await getEffectivePolicy(wsId, 'retention')
    expect(effective).not.toBeNull()
    expect(effective!.id).toBe(orgPolicy!.id)
    expect(effective!.org_id).toBe(orgId)
    expect(effective!.config).toEqual(config)
  })

  it('returns null for a non-existent workspace', async () => {
    const fakeWsId = 'ws-nonexistent'
    const policy = await getEffectivePolicy(fakeWsId, 'dlp')
    expect(policy).toBeNull()
  })

  it('returns effective policy for different policy types', async () => {
    const orgId = await mkOrg()
    const wsId = await mkWorkspace(orgId)

    const types: PolicyType[] = ['retention', 'dlp', 'sso']
    const configs = [{ days: 60 }, { rules: [] }, { enabled: true }]

    for (let i = 0; i < types.length; i++) {
      await setOrgPolicy(orgId, types[i], configs[i])
      const effective = await getEffectivePolicy(wsId, types[i])
      expect(effective).not.toBeNull()
      expect(effective!.policy_type).toBe(types[i])
      expect(effective!.config).toEqual(configs[i])
    }
  })

  it('returns policy even if enforced=false', async () => {
    const orgId = await mkOrg()
    const wsId = await mkWorkspace(orgId)
    const config = { timeout: 1800 }
    await setOrgPolicy(orgId, 'session', config, false)

    const effective = await getEffectivePolicy(wsId, 'session')
    expect(effective).not.toBeNull()
    expect(effective!.enforced).toBe(false)
  })
})

describe('deleteOrgPolicy', () => {
  it('deletes an existing policy and returns true', async () => {
    const orgId = await mkOrg()
    await setOrgPolicy(orgId, 'retention', { days: 30 })

    const result = await deleteOrgPolicy(orgId, 'retention')
    expect(result).toBe(true)

    // verify it's gone
    const fetched = await getOrgPolicy(orgId, 'retention')
    expect(fetched).toBeNull()
  })

  it('returns false when trying to delete a non-existent policy', async () => {
    const orgId = await mkOrg()
    const result = await deleteOrgPolicy(orgId, 'sso')
    expect(result).toBe(false)
  })

  it('returns false for a non-existent org', async () => {
    const fakeOrgId = randomUUID()
    const result = await deleteOrgPolicy(fakeOrgId, 'dlp')
    expect(result).toBe(false)
  })

  it('deletes only the specified policy type in an org with multiple policies', async () => {
    const orgId = await mkOrg()

    await setOrgPolicy(orgId, 'retention', { days: 30 })
    await setOrgPolicy(orgId, 'sso', { enabled: true })
    await setOrgPolicy(orgId, 'dlp', { rules: [] })

    const result = await deleteOrgPolicy(orgId, 'sso')
    expect(result).toBe(true)

    const policies = await listOrgPolicies(orgId)
    expect(policies.length).toBe(2)
    expect(policies.map(p => p.policy_type)).toEqual(['dlp', 'retention'])
  })

  it('allows re-creating a policy after deletion', async () => {
    const orgId = await mkOrg()
    const config1 = { days: 30 }
    await setOrgPolicy(orgId, 'retention', config1)
    await deleteOrgPolicy(orgId, 'retention')

    const config2 = { days: 60 }
    const recreated = await setOrgPolicy(orgId, 'retention', config2)

    expect(recreated).not.toBeNull()
    expect(recreated!.config).toEqual(config2)
  })
})

describe('round-trip workflows', () => {
  it('create -> get -> update -> delete cycle', async () => {
    const orgId = await mkOrg()

    // Create
    const policy1 = await setOrgPolicy(orgId, 'ip_access', { whitelist: ['10.0.0.0/8'] })
    expect(policy1).not.toBeNull()

    // Get
    const fetched = await getOrgPolicy(orgId, 'ip_access')
    expect(fetched!.id).toBe(policy1!.id)

    // Update via upsert
    const policy2 = await setOrgPolicy(orgId, 'ip_access', { whitelist: ['10.0.0.0/8', '192.168.0.0/16'] })
    expect(policy2!.id).toBe(policy1!.id)
    expect(policy2!.config).toEqual({ whitelist: ['10.0.0.0/8', '192.168.0.0/16'] })

    // Delete
    const deleted = await deleteOrgPolicy(orgId, 'ip_access')
    expect(deleted).toBe(true)

    const final = await getOrgPolicy(orgId, 'ip_access')
    expect(final).toBeNull()
  })

  it('workspace inherits org policy through effective resolution', async () => {
    const orgId = await mkOrg()
    const ws1 = await mkWorkspace(orgId)
    const ws2 = await mkWorkspace(orgId)

    const config = { enabled: true, provider: 'okta' }
    const orgPolicy = await setOrgPolicy(orgId, 'sso', config, true)

    const effective1 = await getEffectivePolicy(ws1, 'sso')
    const effective2 = await getEffectivePolicy(ws2, 'sso')

    expect(effective1!.id).toBe(orgPolicy!.id)
    expect(effective2!.id).toBe(orgPolicy!.id)
    expect(effective1!.config).toEqual(config)
    expect(effective2!.config).toEqual(config)
  })

  it('list and verify all policy types can be stored and retrieved', async () => {
    const orgId = await mkOrg()
    const types: PolicyType[] = ['retention', 'dlp', 'sso', 'session', 'ip_access', 'data_residency']

    for (const policyType of types) {
      const config = { type: policyType }
      await setOrgPolicy(orgId, policyType, config)
    }

    const policies = await listOrgPolicies(orgId)
    expect(policies.length).toBe(types.length)

    const retrievedTypes = policies.map(p => p.policy_type).sort()
    const expectedTypes = [...types].sort()
    expect(retrievedTypes).toEqual(expectedTypes)
  })
})
