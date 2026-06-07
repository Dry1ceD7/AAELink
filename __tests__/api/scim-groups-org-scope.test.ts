/**
 * Integration tests for org-scoped SCIM Groups provisioning (Identity 16).
 *
 * SCIM authenticates by bearer token (no cookie), so the handlers are invoked
 * directly. Verifies that every Groups operation is scoped to the org of the
 * presented bearer token: a token of org A can never read or modify org B's
 * groups (cross-org → 404), the same-org flow works end to end, and group
 * writes append an audit_log row.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID, createHash } from 'crypto'
import { createTestContext, asRequest, TestContext } from '../helpers'
import {
  GET as scimGet,
  POST as scimPost,
  PUT as scimPut,
  PATCH as scimPatch,
  DELETE as scimDelete,
} from '@/app/api/scim/v2/Groups/route'

let ctx: TestContext
const orgIds: string[] = []
const connIds: string[] = []
const groupIds: string[] = []

async function mkOrg(): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.organizations (id, name, domain) VALUES ($1, $2, $3)`,
    [id, `Org ${id.slice(0, 6)}`, `${id.slice(0, 8)}.example.test`]
  )
  orgIds.push(id)
  return id
}

async function mkConnection(orgId: string | null): Promise<string> {
  const id = randomUUID()
  const token = `scim_${randomUUID().replace(/-/g, '')}`
  const hash = createHash('sha256').update(token).digest('hex')
  await ctx.pool.query(
    `INSERT INTO aaelink.scim_connections (id, name, provider, bearer_token_hash, is_active, created_at, org_id)
     VALUES ($1, $2, 'azure_ad', $3, true, $4, $5)`,
    [id, `conn-${id.slice(0, 6)}`, hash, Date.now(), orgId]
  )
  connIds.push(id)
  return token
}

function req(method: string, path: string, token: string, body?: Record<string, unknown>) {
  return asRequest(method, path, {
    headers: { authorization: `Bearer ${token}` },
    ...(body ? { body } : {}),
  }) as unknown as Request
}

async function createGroup(token: string, displayName: string): Promise<string> {
  const res = await scimPost(req('POST', '/api/scim/v2/Groups', token, { displayName }))
  expect(res.status).toBe(201)
  const body = await res.json() as { id: string }
  groupIds.push(body.id)
  return body.id
}

async function auditCount(action: string, groupId: string): Promise<number> {
  const { rows } = await ctx.pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM aaelink.audit_log WHERE action = $1 AND resource_id = $2`,
    [action, groupId]
  )
  return Number(rows[0]?.n) || 0
}

/** Poll for a fire-and-forget audit row (writeAuditLog is non-awaited). */
async function waitForAudit(action: string, groupId: string): Promise<number> {
  for (let i = 0; i < 20; i++) {
    const n = await auditCount(action, groupId)
    if (n > 0) return n
    await new Promise(r => setTimeout(r, 25))
  }
  return 0
}

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  if (groupIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.user_group_members WHERE group_id = ANY($1)`, [groupIds]).catch(() => {})
    await ctx.pool.query(`DELETE FROM aaelink.audit_log WHERE resource_id = ANY($1)`, [groupIds]).catch(() => {})
    await ctx.pool.query(`DELETE FROM aaelink.user_groups WHERE id = ANY($1)`, [groupIds]).catch(() => {})
  }
  if (connIds.length) await ctx.pool.query(`DELETE FROM aaelink.scim_connections WHERE id = ANY($1)`, [connIds])
  if (orgIds.length) await ctx.pool.query(`DELETE FROM aaelink.organizations WHERE id = ANY($1)`, [orgIds])
})

describe('org-scoped SCIM Groups', () => {
  it('rejects a request without a valid bearer token', async () => {
    const res = await scimPost(asRequest('POST', '/api/scim/v2/Groups', {
      body: { displayName: 'x' },
    }) as unknown as Request)
    expect(res.status).toBe(401)
  })

  it('supports the same-org create/read/patch/delete flow', async () => {
    const org = await mkOrg()
    const token = await mkConnection(org)
    const id = await createGroup(token, `grp-${randomUUID().slice(0, 8)}`)

    // org_id is persisted on the group
    const { rows } = await ctx.pool.query<{ org_id: string }>(
      `SELECT org_id::text AS org_id FROM aaelink.user_groups WHERE id = $1`, [id]
    )
    expect(rows[0]?.org_id).toBe(org)

    // same-org read
    const getRes = await scimGet(req('GET', `/api/scim/v2/Groups/${id}`, token))
    expect(getRes.status).toBe(200)

    // same-org patch (rename)
    const patchRes = await scimPatch(req('PATCH', `/api/scim/v2/Groups/${id}`, token, {
      Operations: [{ op: 'replace', path: 'displayName', value: 'Renamed' }],
    }))
    expect(patchRes.status).toBe(200)
    const patched = await patchRes.json() as { displayName: string }
    expect(patched.displayName).toBe('Renamed')

    // same-org delete
    const delRes = await scimDelete(req('DELETE', `/api/scim/v2/Groups/${id}`, token))
    expect(delRes.status).toBe(204)
  })

  it('list only returns groups of the token org', async () => {
    const orgA = await mkOrg()
    const orgB = await mkOrg()
    const tokenA = await mkConnection(orgA)
    const tokenB = await mkConnection(orgB)
    const idA = await createGroup(tokenA, `a-${randomUUID().slice(0, 8)}`)
    const idB = await createGroup(tokenB, `b-${randomUUID().slice(0, 8)}`)

    const res = await scimGet(req('GET', '/api/scim/v2/Groups', tokenA))
    expect(res.status).toBe(200)
    const body = await res.json() as { Resources: Array<{ id: string }> }
    const ids = body.Resources.map(r => r.id)
    expect(ids).toContain(idA)
    expect(ids).not.toContain(idB)
  })

  it('blocks cross-org read/update/delete with 404', async () => {
    const orgA = await mkOrg()
    const orgB = await mkOrg()
    const tokenA = await mkConnection(orgA)
    const tokenB = await mkConnection(orgB)
    const idA = await createGroup(tokenA, `x-${randomUUID().slice(0, 8)}`)

    // org B cannot read org A's group
    const getRes = await scimGet(req('GET', `/api/scim/v2/Groups/${idA}`, tokenB))
    expect(getRes.status).toBe(404)

    // org B cannot PUT org A's group
    const putRes = await scimPut(req('PUT', `/api/scim/v2/Groups/${idA}`, tokenB, { displayName: 'hijack' }))
    expect(putRes.status).toBe(404)

    // org B cannot PATCH org A's group
    const patchRes = await scimPatch(req('PATCH', `/api/scim/v2/Groups/${idA}`, tokenB, {
      Operations: [{ op: 'replace', path: 'displayName', value: 'hijack' }],
    }))
    expect(patchRes.status).toBe(404)

    // org B cannot DELETE org A's group
    const delRes = await scimDelete(req('DELETE', `/api/scim/v2/Groups/${idA}`, tokenB))
    expect(delRes.status).toBe(404)

    // org A's group is untouched
    const { rows } = await ctx.pool.query<{ name: string }>(
      `SELECT name FROM aaelink.user_groups WHERE id = $1`, [idA]
    )
    expect(rows[0]?.name).not.toBe('hijack')
  })

  it('writes an audit_log row on group create', async () => {
    const org = await mkOrg()
    const token = await mkConnection(org)
    const id = await createGroup(token, `aud-${randomUUID().slice(0, 8)}`)

    const n = await waitForAudit('scim.group.create', id)
    expect(n).toBeGreaterThan(0)

    const { rows } = await ctx.pool.query<{ actor_id: string; metadata: { org_id: string } }>(
      `SELECT actor_id, metadata FROM aaelink.audit_log WHERE action = 'scim.group.create' AND resource_id = $1 LIMIT 1`,
      [id]
    )
    expect(rows[0]?.actor_id).toMatch(/^scim:/)
    expect(rows[0]?.metadata?.org_id).toBe(org)
  })
})
