/**
 * Integration tests for POST /api/admin/retention/enforce.
 *
 * The route was repointed off its own naive raw-cutoff DELETE onto the shared,
 * hold-aware engine (runRetentionEnforcement -> buildHoldExclusion). These tests
 * pin the load-bearing parity guarantee (Admin 16): a message under an ACTIVE
 * legal hold survives enforcement, while a message past the cutoff with NO hold
 * is deleted. Auth gating (401 / 403) is also covered.
 *
 * DB: live PG (postgresql://aaelink:aaelink@127.0.0.1:25432/aaelink).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, createTestChannel, asRequest,
  cleanupTestData, TestContext, TestUser,
} from '../helpers'

let ctx: TestContext
let admin: TestUser
let employee: TestUser
const userIds: string[] = []
const channelIds: string[] = []
const holdIds: string[] = []

const DAY_MS = 86_400_000

/** Seed a message in `channelId` created `ageDays` ago; returns its id. */
async function seedOldMessage(channelId: string, ownerId: string, ageDays: number): Promise<string> {
  const id = randomUUID()
  const at = Date.now() - ageDays * DAY_MS
  await ctx.pool.query(
    `INSERT INTO aaelink.messages (id, channel_id, user_id, body, created_at, updated_at)
     VALUES ($1, $2, $3, 'old', $4, $4)`,
    [id, channelId, ownerId, at]
  )
  return id
}

/** Create an active legal hold scoped to a single channel. */
async function seedChannelHold(channelId: string): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.legal_holds
       (id, name, status, channel_ids, scope_from, scope_to, released_at, created_at)
     VALUES ($1, 'test-hold', 'active', $2::jsonb, 0, 0, 0, $3)`,
    [id, JSON.stringify([channelId]), Date.now()]
  )
  holdIds.push(id)
  return id
}

async function setWorkspacePolicy(retentionDays: number, enabled: boolean): Promise<void> {
  await ctx.pool.query(
    `UPDATE aaelink.retention_policies SET retention_days = $1, enabled = $2 WHERE scope = 'workspace'`,
    [retentionDays, enabled]
  )
}

beforeAll(async () => {
  ctx = await createTestContext()
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  employee = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(admin.id, employee.id)
})

afterAll(async () => {
  // Restore the shared default so this run does not contaminate other tests.
  await setWorkspacePolicy(0, false).catch(() => {})
  if (holdIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.legal_holds WHERE id = ANY($1)`, [holdIds])
  }
  if (channelIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = ANY($1)`, [channelIds])
  }
  await cleanupTestData(ctx.pool, userIds)
  await ctx.cleanup()
})

describe('POST /api/admin/retention/enforce — auth', () => {
  it('returns 401 without a session', async () => {
    const { POST } = await import('@/app/api/admin/retention/enforce/route')
    const res = await POST(asRequest('POST', '/api/admin/retention/enforce', { body: {} }))
    expect(res.status).toBe(401)
  })

  it('returns 403 for a non-admin', async () => {
    const { POST } = await import('@/app/api/admin/retention/enforce/route')
    const res = await POST(asRequest('POST', '/api/admin/retention/enforce', {
      cookie: employee.sessionCookie, body: {},
    }))
    expect(res.status).toBe(403)
  })
})

describe('POST /api/admin/retention/enforce — legal-hold exclusion', () => {
  it('keeps a held message but deletes an unheld message past cutoff', async () => {
    const heldChannel = await createTestChannel(ctx.pool, admin.id, { name: `held-${randomUUID().slice(0, 8)}` })
    const freeChannel = await createTestChannel(ctx.pool, admin.id, { name: `free-${randomUUID().slice(0, 8)}` })
    channelIds.push(heldChannel.id, freeChannel.id)

    // Both messages are 400 days old; an enabled 30-day workspace policy puts
    // both past the cutoff. The active hold protects only heldChannel.
    const heldMsg = await seedOldMessage(heldChannel.id, admin.id, 400)
    const freeMsg = await seedOldMessage(freeChannel.id, admin.id, 400)
    await seedChannelHold(heldChannel.id)
    await setWorkspacePolicy(30, true)

    const { POST } = await import('@/app/api/admin/retention/enforce/route')
    const res = await POST(asRequest('POST', '/api/admin/retention/enforce', {
      cookie: admin.sessionCookie, body: {},
    }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      purged: Record<string, { messages_deleted: number }>
      policies_executed: number
    }
    expect(body.policies_executed).toBeGreaterThanOrEqual(1)
    expect(body.purged.workspace).toBeDefined()

    // The held message survives; the unheld one past cutoff is gone.
    const held = await ctx.pool.query(`SELECT id FROM aaelink.messages WHERE id = $1`, [heldMsg])
    expect(held.rows).toHaveLength(1)
    const free = await ctx.pool.query(`SELECT id FROM aaelink.messages WHERE id = $1`, [freeMsg])
    expect(free.rows).toHaveLength(0)
  })
})
