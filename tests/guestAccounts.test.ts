/**
 * AAELink — guest account revoke + scheduled expiry tests (Admin parity 29).
 *
 * Verifies the shared revoke path (revokeGuestAccount) used by both the manual
 * DELETE /api/admin/guests handler and the worker 'guest_expire' job, plus the
 * job body (runGuestExpiry): an expired guest is fully revoked (channel +
 * workspace membership gone, account row gone, sessions killed), an unexpired
 * guest is untouched, and a re-run is idempotent (revokes nothing twice).
 * Live Postgres pool (integration-style), mirroring tests/userDeactivation.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext,
  createTestUser,
  createTestChannel,
  ensureSystemWorkspace,
  cleanupTestData,
  type TestContext,
  type TestUser,
} from '../__tests__/helpers'
import { revokeGuestAccount, runGuestExpiry } from '../lib/comms/guestAccounts'

let ctx: TestContext
let workspaceId: string
let adminId: string
const createdIds: string[] = []
const guestIds: string[] = []

async function sessionCount(userId: string): Promise<number> {
  const { rows } = await ctx.pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM aaelink.sessions WHERE user_id = $1`, [userId]
  )
  return Number(rows[0]?.n || 0)
}

async function guestExists(guestId: string): Promise<boolean> {
  const { rows } = await ctx.pool.query(
    `SELECT 1 FROM aaelink.guest_accounts WHERE id = $1`, [guestId]
  )
  return rows.length > 0
}

async function isChannelMember(channelId: string, userId: string): Promise<boolean> {
  const { rows } = await ctx.pool.query(
    `SELECT 1 FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`, [channelId, userId]
  )
  return rows.length > 0
}

async function isWorkspaceGuest(userId: string): Promise<boolean> {
  const { rows } = await ctx.pool.query(
    `SELECT 1 FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2 AND role = 'guest'`,
    [workspaceId, userId]
  )
  return rows.length > 0
}

/** Create a guest_accounts row for `guestUser` with one channel + membership. */
async function seedGuest(guestUserId: string, channelId: string, expiresAt: number): Promise<string> {
  const id = randomUUID()
  guestIds.push(id)
  const now = Date.now()
  await ctx.pool.query(
    `INSERT INTO aaelink.guest_accounts (id, workspace_id, user_id, invited_by, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET expires_at = $5`,
    [id, workspaceId, guestUserId, adminId, expiresAt, now]
  )
  await ctx.pool.query(
    `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'guest')
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'guest'`,
    [workspaceId, guestUserId]
  )
  await ctx.pool.query(
    `INSERT INTO aaelink.guest_channel_access (guest_id, channel_id, granted_at)
     VALUES ($1, $2, $3) ON CONFLICT (guest_id, channel_id) DO NOTHING`,
    [id, channelId, now]
  )
  await ctx.pool.query(
    `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
     VALUES ($1, $2, 'member', $3) ON CONFLICT (channel_id, user_id) DO NOTHING`,
    [channelId, guestUserId, now]
  )
  return id
}

beforeAll(async () => {
  ctx = await createTestContext()
  workspaceId = await ensureSystemWorkspace(ctx.pool)
  const admin: TestUser = await createTestUser(ctx.pool, { role: 'platform_admin' })
  adminId = admin.id
  createdIds.push(admin.id)
})

afterAll(async () => {
  // guest_accounts/channel_access cascade off users, but clean explicitly first.
  for (const gid of guestIds) {
    await ctx.pool.query(`DELETE FROM aaelink.guest_accounts WHERE id = $1`, [gid]).catch(() => {})
  }
  await cleanupTestData(ctx.pool, createdIds)
})

describe('revokeGuestAccount', () => {
  it('revokes an expired guest: account, memberships, and sessions gone', async () => {
    const guest = await createTestUser(ctx.pool, { role: 'guest' })
    createdIds.push(guest.id)
    const channel = await createTestChannel(ctx.pool, adminId, { workspaceId })
    const gid = await seedGuest(guest.id, channel.id, Date.now() - 1000)

    expect(await guestExists(gid)).toBe(true)
    expect(await isChannelMember(channel.id, guest.id)).toBe(true)
    expect(await isWorkspaceGuest(guest.id)).toBe(true)
    expect(await sessionCount(guest.id)).toBe(1) // createTestUser seeds one session

    const did = await revokeGuestAccount(ctx.pool, gid, { actorId: adminId, action: 'guest.revoke' })
    expect(did).toBe(true)

    expect(await guestExists(gid)).toBe(false)
    expect(await isChannelMember(channel.id, guest.id)).toBe(false)
    expect(await isWorkspaceGuest(guest.id)).toBe(false)
    expect(await sessionCount(guest.id)).toBe(0)
  })

  it('writes an audit_log row for the revoke', async () => {
    const guest = await createTestUser(ctx.pool, { role: 'guest' })
    createdIds.push(guest.id)
    const channel = await createTestChannel(ctx.pool, adminId, { workspaceId })
    const gid = await seedGuest(guest.id, channel.id, Date.now() - 1000)

    await revokeGuestAccount(ctx.pool, gid, { actorId: adminId, action: 'guest.revoke' })

    const { rows } = await ctx.pool.query(
      `SELECT actor_id, action, resource_id FROM aaelink.audit_log
        WHERE resource_id = $1 AND action = 'guest.revoke'`, [gid]
    )
    expect(rows.length).toBe(1)
    expect(rows[0].actor_id).toBe(adminId)
  })

  it('returns false for an already-revoked / missing guest (idempotent no-op)', async () => {
    const did = await revokeGuestAccount(ctx.pool, randomUUID(), { actorId: adminId })
    expect(did).toBe(false)
  })
})

describe('runGuestExpiry', () => {
  it('revokes only guests past expires_at, leaves unexpired and no-expiry guests untouched', async () => {
    const now = Date.now()
    const expired = await createTestUser(ctx.pool, { role: 'guest' })
    const future = await createTestUser(ctx.pool, { role: 'guest' })
    const noExpiry = await createTestUser(ctx.pool, { role: 'guest' })
    createdIds.push(expired.id, future.id, noExpiry.id)

    const chA = await createTestChannel(ctx.pool, adminId, { workspaceId })
    const chB = await createTestChannel(ctx.pool, adminId, { workspaceId })
    const chC = await createTestChannel(ctx.pool, adminId, { workspaceId })

    const gExpired = await seedGuest(expired.id, chA.id, now - 5000)
    const gFuture = await seedGuest(future.id, chB.id, now + 60 * 60_000)
    const gNoExpiry = await seedGuest(noExpiry.id, chC.id, 0) // 0 = never expires

    const res = await runGuestExpiry(ctx.pool, now)
    // At least our expired guest; other suites may seed expired guests too, so
    // assert our specific outcomes rather than an exact global count.
    expect(res.revoked).toBeGreaterThanOrEqual(1)

    // Expired guest fully revoked.
    expect(await guestExists(gExpired)).toBe(false)
    expect(await isChannelMember(chA.id, expired.id)).toBe(false)
    expect(await sessionCount(expired.id)).toBe(0)

    // Future + no-expiry guests untouched.
    expect(await guestExists(gFuture)).toBe(true)
    expect(await isChannelMember(chB.id, future.id)).toBe(true)
    expect(await sessionCount(future.id)).toBe(1)
    expect(await guestExists(gNoExpiry)).toBe(true)
    expect(await isChannelMember(chC.id, noExpiry.id)).toBe(true)
    expect(await sessionCount(noExpiry.id)).toBe(1)

    // Audit logged for the expired guest with the scheduled action.
    const { rows: audit } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.audit_log WHERE resource_id = $1 AND action = 'guest.expire'`, [gExpired]
    )
    expect(audit.length).toBe(1)
  })

  it('is idempotent: a re-run revokes nothing already handled', async () => {
    const now = Date.now()
    const expired = await createTestUser(ctx.pool, { role: 'guest' })
    createdIds.push(expired.id)
    const ch = await createTestChannel(ctx.pool, adminId, { workspaceId })
    const gid = await seedGuest(expired.id, ch.id, now - 5000)

    const first = await runGuestExpiry(ctx.pool, now)
    expect(first.revoked).toBeGreaterThanOrEqual(1)
    expect(await guestExists(gid)).toBe(false)

    // Second pass: our guest is already gone, so it must not be revoked again.
    const before = await ctx.pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM aaelink.guest_accounts WHERE expires_at > 0 AND expires_at <= $1`, [now]
    )
    const second = await runGuestExpiry(ctx.pool, now)
    expect(second.revoked).toBe(Number(before.rows[0]?.n || 0))
    // No duplicate audit row for our already-handled guest.
    const { rows: audit } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.audit_log WHERE resource_id = $1 AND action = 'guest.expire'`, [gid]
    )
    expect(audit.length).toBe(1)
  })
})
