/**
 * Integration tests for D2 org-scoped SCIM provisioning.
 *
 * SCIM authenticates by bearer token (no cookie), so the handlers are invoked
 * directly. Verifies that a connection bound to an org enrolls provisioned users
 * into org_members and deprovisions them on delete, while a global (org_id NULL)
 * connection enrolls no one.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID, createHash } from 'crypto'
import { createTestContext, asRequest, TestContext } from '../helpers'
import { POST as scimPost, DELETE as scimDelete } from '@/app/api/scim/v2/Users/route'

let ctx: TestContext
const orgIds: string[] = []
const connIds: string[] = []
const userIds: string[] = []

async function mkOrg(): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.organizations (id, name, domain) VALUES ($1, $2, $3)`,
    [id, `Org ${id.slice(0, 6)}`, `${id.slice(0, 8)}.example.test`]
  )
  orgIds.push(id)
  return id
}

/** Create a SCIM connection and return its bearer token. */
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

function scimBody(userName: string) {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    userName,
    name: { givenName: 'Test', familyName: 'User' },
    emails: [{ value: `${userName}@scim.test`, primary: true }],
    active: true,
  }
}

async function isOrgMember(orgId: string, uid: string): Promise<boolean> {
  const { rows } = await ctx.pool.query(
    `SELECT 1 FROM aaelink.org_members WHERE org_id = $1 AND user_id = $2`, [orgId, uid]
  )
  return rows.length > 0
}

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  if (orgIds.length) await ctx.pool.query(`DELETE FROM aaelink.org_members WHERE org_id = ANY($1)`, [orgIds])
  if (userIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.scim_sync_log WHERE user_id = ANY($1)`, [userIds]).catch(() => {})
    await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
    await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
  }
  if (connIds.length) await ctx.pool.query(`DELETE FROM aaelink.scim_connections WHERE id = ANY($1)`, [connIds])
  if (orgIds.length) await ctx.pool.query(`DELETE FROM aaelink.organizations WHERE id = ANY($1)`, [orgIds])
})

async function provision(token: string, userName: string) {
  const res = await scimPost(asRequest('POST', '/api/scim/v2/Users', {
    headers: { authorization: `Bearer ${token}` },
    body: scimBody(userName),
  }) as unknown as Request)
  const body = await res.json() as { id?: string }
  if (body.id) userIds.push(body.id)
  return { res, id: body.id }
}

describe('org-scoped SCIM', () => {
  it('rejects a request without a valid bearer token', async () => {
    const res = await scimPost(asRequest('POST', '/api/scim/v2/Users', { body: scimBody('x') }) as unknown as Request)
    expect(res.status).toBe(401)
  })

  it('enrolls a provisioned user into the connection org, then deprovisions on delete', async () => {
    const org = await mkOrg()
    const token = await mkConnection(org)

    const { res, id } = await provision(token, `scim-${randomUUID().slice(0, 8)}`)
    expect(res.status).toBe(201)
    expect(id).toBeTruthy()
    expect(await isOrgMember(org, id!)).toBe(true)

    const del = await scimDelete(asRequest('DELETE', `/api/scim/v2/Users/${id}`, {
      headers: { authorization: `Bearer ${token}` },
    }) as unknown as Request)
    expect(del.status).toBe(204)
    expect(await isOrgMember(org, id!)).toBe(false)

    const { rows } = await ctx.pool.query<{ scim_active: boolean }>(
      `SELECT scim_active FROM aaelink.users WHERE id = $1`, [id]
    )
    expect(rows[0]?.scim_active).toBe(false) // soft-deactivated, not hard-deleted
  })

  it('does not enroll anyone for a global (org_id NULL) connection', async () => {
    const org = await mkOrg()
    const token = await mkConnection(null)

    const { res, id } = await provision(token, `glob-${randomUUID().slice(0, 8)}`)
    expect(res.status).toBe(201)
    expect(await isOrgMember(org, id!)).toBe(false)
  })
})
