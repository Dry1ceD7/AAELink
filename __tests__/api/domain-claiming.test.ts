/**
 * Integration tests for D2 domain claiming + account capture.
 *
 * Exercises lib/enterprise/domainClaiming.ts against a live Postgres at the
 * function boundary. DNS is injected (TxtResolver) so verification is
 * deterministic. The route (app/api/admin/org/[orgId]/domains) is a thin
 * platform-admin + audit wrapper supplying a real node:dns resolver.
 *
 * Covers claimDomain, verifyDomain, listOrgDomains, removeOrgDomain,
 * findCapturingOrg, and the normalize/email helpers.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import {
  claimDomain,
  verifyDomain,
  listOrgDomains,
  removeOrgDomain,
  findCapturingOrg,
  verificationRecord,
  normalizeDomain,
  emailDomain,
  type TxtResolver,
} from '@/lib/enterprise/domainClaiming'

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

/** Resolver that returns fixed TXT records for one domain, [] otherwise. */
function resolverFor(domain: string, records: string[]): TxtResolver {
  return async (host) => (host === domain ? records : [])
}
const emptyResolver: TxtResolver = async () => []

beforeAll(async () => {
  ctx = await createTestContext()
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  userIds.push(admin.id)
})

afterAll(async () => {
  if (orgIds.length) await ctx.pool.query(`DELETE FROM aaelink.org_domains WHERE org_id = ANY($1)`, [orgIds])
  if (orgIds.length) await ctx.pool.query(`DELETE FROM aaelink.organizations WHERE id = ANY($1)`, [orgIds])
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('helpers', () => {
  it('normalizeDomain strips scheme, @, path, case', () => {
    expect(normalizeDomain('  HTTPS://Foo.COM/bar ')).toBe('foo.com')
    expect(normalizeDomain('@Acme.IO')).toBe('acme.io')
    expect(normalizeDomain('host.example.com:443')).toBe('host.example.com')
  })
  it('emailDomain extracts the domain', () => {
    expect(emailDomain('User@Example.com')).toBe('example.com')
    expect(emailDomain('not-an-email')).toBe('')
  })
})

describe('claimDomain', () => {
  it('rejects a malformed domain (invalid_domain)', async () => {
    const org = await mkOrg()
    expect(await claimDomain(ctx.pool, org, 'nodot', admin.id)).toEqual({ ok: false, code: 'invalid_domain' })
  })

  it('creates a pending claim and returns the TXT record', async () => {
    const org = await mkOrg()
    const d = `claim-${randomUUID().slice(0, 8)}.test`
    const res = await claimDomain(ctx.pool, org, d, admin.id)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.domain).toBe(d)
      expect(res.record).toBe(verificationRecord(res.token))
    }
    const list = await listOrgDomains(ctx.pool, org)
    expect(list.find(x => x.domain === d)?.verified).toBe(false)
  })

  it('guards a re-claim by the same org (already_claimed)', async () => {
    const org = await mkOrg()
    const d = `dup-${randomUUID().slice(0, 8)}.test`
    await claimDomain(ctx.pool, org, d, admin.id)
    expect(await claimDomain(ctx.pool, org, d, admin.id)).toEqual({ ok: false, code: 'already_claimed' })
  })
})

describe('verifyDomain', () => {
  it('rejects an unknown claim (not_found)', async () => {
    const org = await mkOrg()
    expect(await verifyDomain(ctx.pool, org, 'ghost.test', emptyResolver)).toEqual({ ok: false, code: 'not_found' })
  })

  it('fails when the TXT record is absent (txt_not_found)', async () => {
    const org = await mkOrg()
    const d = `unv-${randomUUID().slice(0, 8)}.test`
    await claimDomain(ctx.pool, org, d, admin.id)
    expect(await verifyDomain(ctx.pool, org, d, emptyResolver)).toEqual({ ok: false, code: 'txt_not_found' })
  })

  it('verifies when the TXT record matches, then guards re-verify', async () => {
    const org = await mkOrg()
    const d = `ok-${randomUUID().slice(0, 8)}.test`
    const claim = await claimDomain(ctx.pool, org, d, admin.id)
    expect(claim.ok).toBe(true)
    const token = claim.ok ? claim.token : ''

    const ok = await verifyDomain(ctx.pool, org, d, resolverFor(d, ['unrelated', verificationRecord(token)]))
    expect(ok).toEqual({ ok: true, domain: d })

    const list = await listOrgDomains(ctx.pool, org)
    const row = list.find(x => x.domain === d)
    expect(row?.verified).toBe(true)
    expect(row?.verified_at).toBeGreaterThan(0)

    expect(await verifyDomain(ctx.pool, org, d, resolverFor(d, [verificationRecord(token)])))
      .toEqual({ ok: false, code: 'already_verified' })
  })

  it('blocks a second org from claiming/verifying a domain already verified', async () => {
    const orgA = await mkOrg()
    const orgB = await mkOrg()
    const d = `contested-${randomUUID().slice(0, 8)}.test`
    const a = await claimDomain(ctx.pool, orgA, d, admin.id)
    const tokenA = a.ok ? a.token : ''
    await verifyDomain(ctx.pool, orgA, d, resolverFor(d, [verificationRecord(tokenA)]))

    // orgB cannot even register a pending claim once A is verified.
    expect(await claimDomain(ctx.pool, orgB, d, admin.id)).toEqual({ ok: false, code: 'claimed_by_other_org' })
  })
})

describe('findCapturingOrg', () => {
  it('returns the verified org for an email under a claimed domain, null otherwise', async () => {
    const org = await mkOrg()
    const d = `capture-${randomUUID().slice(0, 8)}.test`
    const claim = await claimDomain(ctx.pool, org, d, admin.id)
    const token = claim.ok ? claim.token : ''

    // Unverified → no capture.
    expect(await findCapturingOrg(ctx.pool, `someone@${d}`)).toBeNull()

    await verifyDomain(ctx.pool, org, d, resolverFor(d, [verificationRecord(token)]))
    expect(await findCapturingOrg(ctx.pool, `Someone@${d}`)).toBe(org)
    expect(await findCapturingOrg(ctx.pool, `someone@other-${d}`)).toBeNull()
    expect(await findCapturingOrg(ctx.pool, 'malformed')).toBeNull()
  })
})

describe('removeOrgDomain', () => {
  it('removes a claim and reports missing ones', async () => {
    const org = await mkOrg()
    const d = `rm-${randomUUID().slice(0, 8)}.test`
    await claimDomain(ctx.pool, org, d, admin.id)
    expect(await removeOrgDomain(ctx.pool, org, d)).toBe(true)
    expect(await removeOrgDomain(ctx.pool, org, d)).toBe(false)
    expect(await listOrgDomains(ctx.pool, org)).toEqual([])
  })
})
