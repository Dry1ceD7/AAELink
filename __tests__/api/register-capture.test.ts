/**
 * Integration test for D2 domain-based account capture at registration.
 *
 * Verifies that POST /api/auth/register enrolls a new user into the org that has
 * verified their email domain (lib/enterprise/domainClaiming.findCapturingOrg),
 * and leaves users with unclaimed domains unattached. Registration is a public
 * route (no cookie auth), so the handler is invoked directly.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, asRequest, parseResponse, TestContext, TestUser } from '../helpers'
import { POST as register } from '@/app/api/auth/register/route'
import { claimDomain, verifyDomain, verificationRecord, type TxtResolver } from '@/lib/enterprise/domainClaiming'

let ctx: TestContext
let actor: TestUser
const orgIds: string[] = []
const emails: string[] = []
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

beforeAll(async () => {
  ctx = await createTestContext()
  actor = await createTestUser(ctx.pool, { role: 'super_admin' })
  userIds.push(actor.id)
  process.env.AAELINK_OPEN_REGISTRATION = '1'
})

afterAll(async () => {
  if (emails.length) {
    await ctx.pool.query(
      `DELETE FROM aaelink.org_members WHERE user_id IN (SELECT id FROM aaelink.users WHERE email = ANY($1))`,
      [emails]
    )
    await ctx.pool.query(`DELETE FROM aaelink.users WHERE email = ANY($1)`, [emails])
  }
  if (orgIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.org_domains WHERE org_id = ANY($1)`, [orgIds])
    await ctx.pool.query(`DELETE FROM aaelink.organizations WHERE id = ANY($1)`, [orgIds])
  }
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
  delete process.env.AAELINK_OPEN_REGISTRATION
})

async function registerUser(email: string) {
  emails.push(email)
  const res = await register(asRequest('POST', '/api/auth/register', {
    body: { username: email.split('@')[0], email, password: 'sup3rsecret!' },
  }) as unknown as Request)
  return { res, body: await parseResponse<{ user?: { id: string }; captured_org_id: string | null }>(res) }
}

describe('register domain capture', () => {
  it('captures a user whose email domain is verified by an org', async () => {
    const org = await mkOrg()
    const domain = `cap-${randomUUID().slice(0, 8)}.test`
    const claim = await claimDomain(ctx.pool, org, domain, actor.id)
    const token = claim.ok ? claim.token : ''
    const resolver: TxtResolver = async (h) => (h === domain ? [verificationRecord(token)] : [])
    await verifyDomain(ctx.pool, org, domain, resolver)

    const { res, body } = await registerUser(`alice@${domain}`)
    expect(res.status).toBe(200)
    expect(body.captured_org_id).toBe(org)

    const { rows } = await ctx.pool.query(
      `SELECT role FROM aaelink.org_members WHERE org_id = $1 AND user_id = $2`,
      [org, body.user?.id]
    )
    expect(rows[0]?.role).toBe('member')
  })

  it('leaves a user with an unclaimed domain unattached', async () => {
    const { res, body } = await registerUser(`bob-${randomUUID().slice(0, 8)}@unclaimed.test`)
    expect(res.status).toBe(200)
    expect(body.captured_org_id).toBeNull()
  })

  it('does not capture when the domain is claimed but not yet verified', async () => {
    const org = await mkOrg()
    const domain = `pending-${randomUUID().slice(0, 8)}.test`
    await claimDomain(ctx.pool, org, domain, actor.id)

    const { body } = await registerUser(`carol@${domain}`)
    expect(body.captured_org_id).toBeNull()
  })
})
