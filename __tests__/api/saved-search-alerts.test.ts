/**
 * Integration tests for the saved-search alerts engine
 * (lib/messaging/savedSearchAlerts.ts + BLUEPRINT §2.1.4).
 *
 * Covers:
 *   - an alerts_enabled saved search notifies its owner on a NEW match
 *     (created_at > watermark), and the watermark advances past it
 *   - a second run does NOT re-notify the same message (dedup via watermark)
 *   - a saved search with alerts_enabled=false is skipped entirely
 *   - ACL: the alert runs as the owner, so a message in a channel the owner
 *     can't read never produces a notification
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, createTestChannel, createTestMessage,
  cleanupTestData,
  TestContext, TestUser
} from '../helpers'

let ctx: TestContext
let owner: TestUser
let outsider: TestUser
let workspaceId: string
const createdIds: string[] = []
const msgIds: string[] = []
const savedIds: string[] = []

const TOKEN = `alertok${randomUUID().slice(0, 8)}`

async function countSavedSearchNotifications(userId: string): Promise<number> {
  const { rows } = await ctx.pool.query<{ c: string }>(
    `SELECT COUNT(*)::int AS c FROM aaelink.notifications WHERE user_id = $1 AND kind = 'saved_search'`,
    [userId]
  )
  return Number(rows[0]?.c) || 0
}

async function insertSavedSearch(opts: {
  userId: string; query: string; alertsEnabled: boolean; watermark: number; name?: string
}): Promise<string> {
  const id = randomUUID()
  savedIds.push(id)
  await ctx.pool.query(
    `INSERT INTO aaelink.saved_searches
       (id, workspace_id, user_id, name, query, filters, alerts_enabled, last_run_at, last_match_created_at)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6, 0, $7)`,
    [id, workspaceId, opts.userId, opts.name || 'watch', opts.query, opts.alertsEnabled, opts.watermark]
  )
  return id
}

async function getWatermark(id: string): Promise<number> {
  const { rows } = await ctx.pool.query<{ w: string }>(
    `SELECT last_match_created_at AS w FROM aaelink.saved_searches WHERE id = $1`, [id]
  )
  return Number(rows[0]?.w) || 0
}

beforeAll(async () => {
  ctx = await createTestContext()
  owner = await createTestUser(ctx.pool, { role: 'employee' })
  outsider = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(owner.id, outsider.id)
  // Use the owner's workspace (the channel the owner creates lands in the system
  // workspace, which both users belong to via createTestUser).
  const { rows } = await ctx.pool.query<{ id: string }>(
    `SELECT workspace_id AS id FROM aaelink.workspace_members WHERE user_id = $1 ORDER BY workspace_id LIMIT 1`,
    [owner.id]
  )
  workspaceId = rows[0].id
})

afterAll(async () => {
  if (savedIds.length) await ctx.pool.query(`DELETE FROM aaelink.saved_searches WHERE id = ANY($1)`, [savedIds])
  if (msgIds.length) await ctx.pool.query(`DELETE FROM aaelink.messages WHERE id = ANY($1)`, [msgIds])
  await ctx.pool.query(`DELETE FROM aaelink.notifications WHERE user_id = ANY($1)`, [createdIds])
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('runSavedSearchAlerts', () => {
  it('notifies the owner on a new match and advances the watermark; no re-notify on rerun', async () => {
    const { runSavedSearchAlerts } = await import('@/lib/messaging/savedSearchAlerts')

    const pub = await createTestChannel(ctx.pool, owner.id, { type: 'public', workspaceId })
    const before = await countSavedSearchNotifications(owner.id)

    // Watermark at T0; the matching message is created AFTER it.
    const t0 = Date.now()
    const savedId = await insertSavedSearch({ userId: owner.id, query: TOKEN, alertsEnabled: true, watermark: t0 })

    const msgId = await createTestMessage(ctx.pool, pub.id, owner.id, `here is the ${TOKEN} we watch for`)
    msgIds.push(msgId)
    // Force created_at strictly after the watermark.
    const matchTs = t0 + 1000
    await ctx.pool.query(`UPDATE aaelink.messages SET created_at = $2 WHERE id = $1`, [msgId, matchTs])

    const out1 = await runSavedSearchAlerts(ctx.pool)
    const mine1 = out1.find(o => o.saved_search_id === savedId)!
    expect(mine1.notified).toBe(true)
    expect(mine1.newMatches).toBeGreaterThanOrEqual(1)

    // Exactly one new saved_search notification for the owner.
    expect(await countSavedSearchNotifications(owner.id)).toBe(before + 1)
    // Watermark advanced past the matched message.
    expect(await getWatermark(savedId)).toBeGreaterThanOrEqual(matchTs)

    // Second run with no new messages: no additional notification.
    const out2 = await runSavedSearchAlerts(ctx.pool)
    const mine2 = out2.find(o => o.saved_search_id === savedId)!
    expect(mine2.notified).toBe(false)
    expect(mine2.newMatches).toBe(0)
    expect(await countSavedSearchNotifications(owner.id)).toBe(before + 1)
  })

  it('skips a saved search with alerts_enabled=false', async () => {
    const { runSavedSearchAlerts } = await import('@/lib/messaging/savedSearchAlerts')

    const tok = `noalert${randomUUID().slice(0, 6)}`
    const pub = await createTestChannel(ctx.pool, owner.id, { type: 'public', workspaceId })
    const t0 = Date.now()
    const savedId = await insertSavedSearch({ userId: owner.id, query: tok, alertsEnabled: false, watermark: t0 })

    const msgId = await createTestMessage(ctx.pool, pub.id, owner.id, `a ${tok} message`)
    msgIds.push(msgId)
    await ctx.pool.query(`UPDATE aaelink.messages SET created_at = $2 WHERE id = $1`, [msgId, t0 + 1000])

    const out = await runSavedSearchAlerts(ctx.pool)
    // The disabled saved search is never even evaluated.
    expect(out.find(o => o.saved_search_id === savedId)).toBeUndefined()
  })

  it('drains a backlog larger than one engine page without skipping any message (oldest-first watermark paging)', async () => {
    // Regression for the "page + advance-to-max" watermark bug: with newest-first
    // ordering + a per-fetch cap (the engine clamps limit to 50), a burst of more
    // than one page of new matches would jump the watermark to the absolute newest
    // and permanently skip everything between the previous watermark and the
    // newest page. The fix pages oldest-first via a millisecond-precise moving
    // watermark, draining the whole backlog in order. Here TOTAL (130) spans 3
    // engine pages (50 + 50 + 30), all drained in a single run.
    const { runSavedSearchAlerts } = await import('@/lib/messaging/savedSearchAlerts')

    const tok = `backlog${randomUUID().slice(0, 6)}`
    const pub = await createTestChannel(ctx.pool, owner.id, { type: 'public', workspaceId })

    const TOTAL = 130 // > one 50-row engine page; requires multi-page draining.
    const t0 = Date.now()
    const savedId = await insertSavedSearch({ userId: owner.id, query: tok, alertsEnabled: true, watermark: t0 })

    // Seed TOTAL matching messages, each with a strictly-increasing created_at
    // after the watermark, so all are "new".
    for (let i = 0; i < TOTAL; i++) {
      const id = await createTestMessage(ctx.pool, pub.id, owner.id, `${tok} burst message number ${i}`)
      msgIds.push(id)
      await ctx.pool.query(`UPDATE aaelink.messages SET created_at = $2 WHERE id = $1`, [id, t0 + 1000 + i])
    }

    const before = await countSavedSearchNotifications(owner.id)

    // Single run drains the entire backlog across multiple engine pages.
    const out1 = await runSavedSearchAlerts(ctx.pool)
    const r1 = out1.find(o => o.saved_search_id === savedId)!
    expect(r1.notified).toBe(true)
    // Every new message is reported — none skipped despite spanning >1 page.
    expect(r1.newMatches).toBe(TOTAL)
    // Exactly ONE summary notification (not one-per-message, not one-per-page).
    expect(await countSavedSearchNotifications(owner.id)).toBe(before + 1)
    // Watermark advanced to the very newest message — nothing left behind.
    expect(await getWatermark(savedId)).toBe(t0 + 1000 + (TOTAL - 1))

    // Second run: nothing new remains, no further notification.
    const out2 = await runSavedSearchAlerts(ctx.pool)
    const r2 = out2.find(o => o.saved_search_id === savedId)!
    expect(r2.notified).toBe(false)
    expect(r2.newMatches).toBe(0)
    expect(await countSavedSearchNotifications(owner.id)).toBe(before + 1)
  })

  it('runs as the owner: a match in a channel the owner cannot read is not alerted', async () => {
    const { runSavedSearchAlerts } = await import('@/lib/messaging/savedSearchAlerts')

    const tok = `aclok${randomUUID().slice(0, 6)}`
    // Private channel owned by the outsider; owner is NOT a member.
    const priv = await createTestChannel(ctx.pool, outsider.id, { type: 'private', workspaceId })
    const before = await countSavedSearchNotifications(owner.id)

    const t0 = Date.now()
    const savedId = await insertSavedSearch({ userId: owner.id, query: tok, alertsEnabled: true, watermark: t0 })

    const msgId = await createTestMessage(ctx.pool, priv.id, outsider.id, `secret ${tok} content`)
    msgIds.push(msgId)
    await ctx.pool.query(`UPDATE aaelink.messages SET created_at = $2 WHERE id = $1`, [msgId, t0 + 1000])

    const out = await runSavedSearchAlerts(ctx.pool)
    const mine = out.find(o => o.saved_search_id === savedId)!
    expect(mine.notified).toBe(false)
    expect(mine.newMatches).toBe(0)
    expect(await countSavedSearchNotifications(owner.id)).toBe(before)
  })
})
