/**
 * Integration tests for DELETE /api/admin/guests (revoke path, Admin parity 29).
 *
 * The DELETE handler was converged onto the shared revokeGuestAccount fn
 * (lib/comms/guestAccounts) — the same path the worker 'guest_expire' job uses.
 * These pin the route contract: an authenticated admin revoke removes the guest
 * account + channel/workspace membership AND kills the guest's sessions, an
 * unknown guest_id returns guest_not_found, a missing guest_id returns 400, and
 * an unauthenticated request is rejected.
 *
 * Requires a live Postgres (run via the integration vitest config).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, createTestChannel, ensureSystemWorkspace,
  asRequest, expectError, cleanupTestData,
  type TestContext, type TestUser,
} from '../helpers'
import { DELETE } from '@/app/api/admin/guests/route'

let ctx: TestContext
let workspaceId: string
let admin: TestUser
const createdIds: string[] = []
const guestRowIds: string[] = []

async function seedGuest(guestUserId: string, channelId: string, expiresAt: number): Promise<string> {
  const id = randomUUID()
  guestRowIds.push(id)
  const now = Date.now()
  await ctx.pool.query(
    `INSERT INTO aaelink.guest_accounts (id, workspace_id, user_id, invited_by, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET expires_at = $5`,
    [id, workspaceId, guestUserId, admin.id, expiresAt, now]
  )
  await ctx.pool.query(
    `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'guest') ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'guest'`,
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

async function sessionCount(userId: string): Promise<number> {
  const { rows } = await ctx.pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM aaelink.sessions WHERE user_id = $1`, [userId]
  )
  return Number(rows[0]?.n || 0)
}

beforeAll(async () => {
  ctx = await createTestContext()
  workspaceId = await ensureSystemWorkspace(ctx.pool)
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  createdIds.push(admin.id)
})

afterAll(async () => {
  if (!ctx) return
  for (const gid of guestRowIds) {
    await ctx.pool.query(`DELETE FROM aaelink.guest_accounts WHERE id = $1`, [gid]).catch(() => {})
  }
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('DELETE /api/admin/guests', () => {
  it('revokes a guest: account, membership, and sessions gone', async () => {
    const guest = await createTestUser(ctx.pool, { role: 'guest' })
    createdIds.push(guest.id)
    const channel = await createTestChannel(ctx.pool, admin.id, { workspaceId })
    const gid = await seedGuest(guest.id, channel.id, Date.now() + 60_000)
    expect(await sessionCount(guest.id)).toBe(1)

    const req = asRequest('DELETE', '/api/admin/guests', {
      cookie: admin.sessionCookie,
      body: { guest_id: gid, workspace_id: workspaceId },
    })
    const res = await DELETE(req)
    expect(res.status).toBe(200)

    const { rows } = await ctx.pool.query(`SELECT 1 FROM aaelink.guest_accounts WHERE id = $1`, [gid])
    expect(rows.length).toBe(0)
    const { rows: cm } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`, [channel.id, guest.id]
    )
    expect(cm.length).toBe(0)
    expect(await sessionCount(guest.id)).toBe(0)
  })

  it('returns guest_not_found for an unknown guest_id', async () => {
    const req = asRequest('DELETE', '/api/admin/guests', {
      cookie: admin.sessionCookie,
      body: { guest_id: randomUUID() },
    })
    await expectError(await DELETE(req), 404, 'guest_not_found')
  })

  it('returns guest_id_required when no id supplied', async () => {
    const req = asRequest('DELETE', '/api/admin/guests', {
      cookie: admin.sessionCookie,
      body: {},
    })
    await expectError(await DELETE(req), 400, 'guest_id_required')
  })

  it('rejects an unauthenticated request', async () => {
    const req = asRequest('DELETE', '/api/admin/guests', { body: { guest_id: randomUUID() } })
    await expectError(await DELETE(req), 401, 'unauthorized')
  })
})
