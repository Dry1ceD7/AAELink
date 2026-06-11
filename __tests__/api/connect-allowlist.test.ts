/**
 * Integration tests for D8 Connect partner allowlist.
 *
 * Exercises lib/enterprise/connectAllowlist.ts against a live Postgres. The
 * route (app/api/admin/org/[orgId]/connect-allowlist) is a thin admin wrapper.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import {
  setPartnerDomain,
  removePartnerDomain,
  listPartnerDomains,
  isPartnerAllowed,
} from '@/lib/enterprise/connectAllowlist'

let ctx: TestContext
let admin: TestUser
const userIds: string[] = []
const orgIds: string[] = []

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
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  userIds.push(admin.id)
})

afterAll(async () => {
  if (orgIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.connect_allowlist WHERE org_id = ANY($1)`, [orgIds])
    await ctx.pool.query(`DELETE FROM aaelink.organizations WHERE id = ANY($1)`, [orgIds])
  }
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('setPartnerDomain', () => {
  it('rejects a malformed domain', async () => {
    const org = await mkOrg()
    expect(await setPartnerDomain(ctx.pool, org, 'nodot', 'allowed', admin.id)).toEqual({ ok: false, code: 'invalid_domain' })
  })

  it('normalizes and upserts (allow then block)', async () => {
    const org = await mkOrg()
    const added = await setPartnerDomain(ctx.pool, org, 'HTTPS://Partner.IO/x', 'allowed', admin.id)
    expect(added).toEqual({ ok: true, domain: 'partner.io', status: 'allowed' })
    expect(await isPartnerAllowed(ctx.pool, org, 'partner.io')).toBe(true)

    // Upsert to blocked.
    await setPartnerDomain(ctx.pool, org, 'partner.io', 'blocked', admin.id)
    expect(await isPartnerAllowed(ctx.pool, org, 'partner.io')).toBe(false)
    const list = await listPartnerDomains(ctx.pool, org)
    expect(list.length).toBe(1)
    expect(list[0].status).toBe('blocked')
  })
})

describe('isPartnerAllowed (default-deny)', () => {
  it('denies unlisted domains and isolates per org', async () => {
    const orgA = await mkOrg()
    const orgB = await mkOrg()
    await setPartnerDomain(ctx.pool, orgA, 'good.com', 'allowed', admin.id)

    expect(await isPartnerAllowed(ctx.pool, orgA, 'good.com')).toBe(true)
    expect(await isPartnerAllowed(ctx.pool, orgA, 'unlisted.com')).toBe(false) // default-deny
    expect(await isPartnerAllowed(ctx.pool, orgB, 'good.com')).toBe(false)     // other org
  })
})

describe('removePartnerDomain', () => {
  it('removes an entry and reports missing ones', async () => {
    const org = await mkOrg()
    await setPartnerDomain(ctx.pool, org, 'temp.io', 'allowed', admin.id)
    expect(await removePartnerDomain(ctx.pool, org, 'temp.io')).toBe(true)
    expect(await removePartnerDomain(ctx.pool, org, 'temp.io')).toBe(false)
    expect(await isPartnerAllowed(ctx.pool, org, 'temp.io')).toBe(false)
  })
})
