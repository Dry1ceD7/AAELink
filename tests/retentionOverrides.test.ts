/**
 * AAELink — per-channel retention override enforcement (live DB).
 *
 * Parity (Admin 14, Slack admin.conversations.setCustomRetention): a per-channel
 * override wins over the workspace scope policy for THAT channel; absence falls
 * back to the scope policy. Legal holds always win — held content is never
 * purged regardless of override.
 *
 * Scenario:
 *   - workspace scope policy enabled at a very long window (10y) so realistic
 *     test data in the shared DB is never collateral-purged by this suite
 *   - channel A: override enabled at 7 days (shorter than workspace)
 *   - channel B: no override (falls back to the long workspace policy)
 * Assertions after runRetentionEnforcement:
 *   - a 30-day-old message in A is PURGED (override 7d wins; 30 > 7)
 *   - a same-age (30-day) message in B SURVIVES (30 << workspace window)
 *   - a 30-day-old message in A under an active legal hold SURVIVES
 *   - a fresh (1-day) message in A SURVIVES (younger than the 7d override)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, createTestChannel,
  TestContext, TestUser, TestChannel,
} from '../__tests__/helpers'
import { runRetentionEnforcement } from '@/lib/enterprise/retentionJob'

const DAY_MS = 86_400_000
let ctx: TestContext
let admin: TestUser
let chA: TestChannel
let chB: TestChannel
const userIds: string[] = []
const holdIds: string[] = []
const msgIds: string[] = []

/** Insert a message with an explicit age (in days). Returns the message id. */
async function seedMsg(channelId: string, userId: string, ageDays: number): Promise<string> {
  const id = randomUUID()
  const ts = Date.now() - ageDays * DAY_MS
  await ctx.pool.query(
    `INSERT INTO aaelink.messages (id, channel_id, user_id, body, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [id, channelId, userId, `msg ${ageDays}d`, ts]
  )
  msgIds.push(id)
  return id
}

async function exists(id: string): Promise<boolean> {
  const { rows } = await ctx.pool.query(`SELECT 1 FROM aaelink.messages WHERE id = $1`, [id])
  return rows.length > 0
}

beforeAll(async () => {
  ctx = await createTestContext()
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  userIds.push(admin.id)
  chA = await createTestChannel(ctx.pool, admin.id, { name: `ret-a-${randomUUID().slice(0, 8)}` })
  chB = await createTestChannel(ctx.pool, admin.id, { name: `ret-b-${randomUUID().slice(0, 8)}` })

  // Workspace scope policy: 10-year window, enabled. A long window proves "B
  // falls back to workspace policy and survives" without collateral-purging
  // unrelated old rows in the shared test DB. Other scopes disabled to isolate.
  await ctx.pool.query(
    `INSERT INTO aaelink.retention_policies (scope, retention_days, enabled)
     VALUES ('workspace', 3650, true)
     ON CONFLICT (scope) DO UPDATE SET retention_days = 3650, enabled = true, delete_files = false`
  )
  await ctx.pool.query(
    `UPDATE aaelink.retention_policies SET enabled = false
      WHERE scope IN ('channel', 'dm', 'file')`
  )

  // Per-channel override on A: 7 days, enabled (shorter than workspace).
  await ctx.pool.query(
    `INSERT INTO aaelink.channel_retention_overrides (channel_id, retention_days, enabled, updated_by)
     VALUES ($1, 7, true, $2)
     ON CONFLICT (channel_id) DO UPDATE SET retention_days = 7, enabled = true`,
    [chA.id, admin.id]
  )
})

afterAll(async () => {
  if (msgIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.messages WHERE id = ANY($1)`, [msgIds]).catch(() => {})
  }
  if (holdIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.legal_holds WHERE id = ANY($1)`, [holdIds]).catch(() => {})
  }
  await ctx.pool.query(
    `DELETE FROM aaelink.channel_retention_overrides WHERE channel_id = ANY($1)`, [[chA.id, chB.id]]
  ).catch(() => {})
  // Reset the shared workspace policy so we don't leak state into sibling suites.
  await ctx.pool.query(
    `UPDATE aaelink.retention_policies SET retention_days = 0, enabled = false WHERE scope = 'workspace'`
  ).catch(() => {})
  await ctx.cleanup()
})

describe('runRetentionEnforcement — per-channel override', () => {
  it('override (7d on A) wins over workspace (90d); B falls back; holds survive', async () => {
    // A: 30d-old (purged by override), 30d-old under hold (survives), 1d-old (survives).
    const aOld = await seedMsg(chA.id, admin.id, 30)
    const aHeld = await seedMsg(chA.id, admin.id, 30)
    const aFresh = await seedMsg(chA.id, admin.id, 1)
    // B: 30d-old — younger than the 90d workspace window → survives.
    const bSameAge = await seedMsg(chB.id, admin.id, 30)

    // Active legal hold over channel A protects aHeld (and aOld too, so to prove
    // the override purges A we scope the hold to a custodian that only aHeld owns).
    const heldOwner = await createTestUser(ctx.pool, { role: 'employee' })
    userIds.push(heldOwner.id)
    await ctx.pool.query(
      `UPDATE aaelink.messages SET user_id = $1 WHERE id = $2`, [heldOwner.id, aHeld]
    )
    const holdId = randomUUID()
    holdIds.push(holdId)
    await ctx.pool.query(
      `INSERT INTO aaelink.legal_holds
         (id, name, status, custodian_ids, channel_ids, scope_from, scope_to, created_by, created_at)
       VALUES ($1, 'test-hold', 'active', $2, '[]'::jsonb, 0, 0, $3, $4)`,
      [holdId, JSON.stringify([heldOwner.id]), admin.id, Date.now()]
    )

    const results = await runRetentionEnforcement(ctx.pool)

    // aOld purged by the 7d override; aHeld survives (hold); aFresh survives (<7d).
    expect(await exists(aOld)).toBe(false)
    expect(await exists(aHeld)).toBe(true)
    expect(await exists(aFresh)).toBe(true)
    // Same-age (30d) message in B survives the 90d workspace policy.
    expect(await exists(bSameAge)).toBe(true)

    // The run reports a channel-override result line for A.
    const aResult = results.find((r) => r.scope === `channel:${chA.id}`)
    expect(aResult).toBeDefined()
    expect(aResult!.messagesDeleted).toBeGreaterThanOrEqual(1)
  })
})
