/**
 * Integration tests for IP allowlist enforcement (Admin parity §31).
 *
 * Covers:
 *  - the admin/ip-access route gate (regression: previously hardcoded
 *    ['super_admin','platform_admin'], now isPlatformAdmin — it_admin allowed)
 *  - config persistence to system_config
 *  - enforceIpAllowlist behavior: blocked IP -> 403 ip_not_allowed, allowed IP
 *    passes, disabled config passes, exempt path passes.
 *
 * The enforcement gate runs at the Node-runtime tracedRoute() chokepoint
 * because Edge middleware cannot read the DB-backed config (pg is edge-excluded).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createTestContext, createTestUser, asRequest, TestContext } from '../helpers'
import { GET as getIpAccess, POST as postIpAccess } from '@/app/api/admin/ip-access/route'
import {
  enforceIpAllowlist,
  invalidateIpAccessCache,
  IP_ACCESS_CONFIG_KEY,
} from '@/lib/auth/ipAccessGate'

let ctx: TestContext
const userIds: string[] = []

async function clearConfig() {
  await ctx.pool.query(`DELETE FROM aaelink.system_config WHERE key = $1`, [IP_ACCESS_CONFIG_KEY])
  invalidateIpAccessCache()
}

async function writeConfig(cfg: Record<string, unknown>) {
  await ctx.pool.query(`
    INSERT INTO aaelink.system_config (key, value, updated_at)
    VALUES ($1, $2, $3)
    ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3
  `, [IP_ACCESS_CONFIG_KEY, JSON.stringify(cfg), Date.now()])
  invalidateIpAccessCache()
}

/** Build a request carrying a specific client IP via X-Forwarded-For. */
function reqWithIp(path: string, ip: string) {
  return asRequest('GET', path, { headers: { 'x-forwarded-for': ip } })
}

beforeAll(async () => { ctx = await createTestContext() })

afterEach(async () => { await clearConfig() })

afterAll(async () => {
  await clearConfig()
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

// ── Route RBAC gate (buggy hardcoded check fixed) ────────────────────

describe('admin ip-access route gate', () => {
  it('rejects a plain member with 403', async () => {
    const member = await createTestUser(ctx.pool, { role: 'employee' })
    userIds.push(member.id)
    const res = await getIpAccess(asRequest('GET', '/api/admin/ip-access', { cookie: member.sessionCookie }) as never)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('forbidden')
  })

  it('allows it_admin (regression: previously locked out by bad role set)', async () => {
    const admin = await createTestUser(ctx.pool, { role: 'it_admin' })
    userIds.push(admin.id)
    const res = await getIpAccess(asRequest('GET', '/api/admin/ip-access', { cookie: admin.sessionCookie }) as never)
    expect(res.status).toBe(200)
    expect((await res.json()).config).toBeDefined()
  })

  it('rejects unauthenticated with 401', async () => {
    const res = await getIpAccess(asRequest('GET', '/api/admin/ip-access') as never)
    expect(res.status).toBe(401)
  })

  it('persists config to system_config on update', async () => {
    const admin = await createTestUser(ctx.pool, { role: 'super_admin' })
    userIds.push(admin.id)
    const res = await postIpAccess(asRequest('POST', '/api/admin/ip-access', {
      cookie: admin.sessionCookie,
      body: { action: 'update', config: { allowlistEnabled: true, allowlist: ['203.0.113.0/24'] } },
    }) as never)
    expect(res.status).toBe(200)
    const { rows } = await ctx.pool.query<{ value: string }>(
      `SELECT value FROM aaelink.system_config WHERE key = $1`, [IP_ACCESS_CONFIG_KEY]
    )
    expect(JSON.parse(rows[0].value).allowlistEnabled).toBe(true)
  })
})

// ── enforceIpAllowlist behavior ──────────────────────────────────────

describe('enforceIpAllowlist', () => {
  it('blocks a non-matching IP with 403 ip_not_allowed', async () => {
    await writeConfig({
      allowlistEnabled: true,
      allowlist: ['203.0.113.0/24'],
      allowPrivateNetworks: false,
    })
    const denied = await enforceIpAllowlist(reqWithIp('/api/messages', '8.8.8.8'), '/api/messages')
    expect(denied).not.toBeNull()
    expect(denied!.status).toBe(403)
    expect((await denied!.json()).error).toBe('ip_not_allowed')
  })

  it('passes an allowlisted IP', async () => {
    await writeConfig({
      allowlistEnabled: true,
      allowlist: ['203.0.113.0/24'],
      allowPrivateNetworks: false,
    })
    const res = await enforceIpAllowlist(reqWithIp('/api/messages', '203.0.113.50'), '/api/messages')
    expect(res).toBeNull()
  })

  it('passes when allowlist config is disabled', async () => {
    await writeConfig({ allowlistEnabled: false, denylistEnabled: false, allowlist: [] })
    const res = await enforceIpAllowlist(reqWithIp('/api/messages', '8.8.8.8'), '/api/messages')
    expect(res).toBeNull()
  })

  it('passes a bypass path even with an enabled allowlist', async () => {
    await writeConfig({
      allowlistEnabled: true,
      allowlist: ['203.0.113.0/24'],
      allowPrivateNetworks: false,
      bypassPaths: ['/api/health'],
    })
    const res = await enforceIpAllowlist(reqWithIp('/api/health', '8.8.8.8'), '/api/health')
    expect(res).toBeNull()
  })
})
