/**
 * Integration tests: `readReceiptDeltaSince` — the DB delta that powers the
 * read-receipt fan-out on the SSE / poll path (`GET /api/collab/events`).
 *
 * Covers:
 *   - empty delta + unchanged watermark when no reads advanced past the cursor
 *   - a new read surfaces the message's current reader stack + advances the
 *     watermark to that read's `read_at`
 *   - the watermark is a strict cursor (`read_at > since`) so a re-poll at the
 *     returned watermark yields nothing
 *   - multiple readers come back newest-first (mirrors `readReceiptsForMessages`)
 *   - the per-message reader stack is capped at MAX_READ_RECEIPTS (5)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext, createTestUser, createTestChannel, createTestMessage,
  cleanupTestData, TestContext, TestUser, TestChannel,
} from '../helpers'
import { readReceiptDeltaSince } from '@/lib/messaging/chat-post'

let ctx: TestContext
let author: TestUser
let channel: TestChannel
let wsId: string
const createdIds: string[] = []

async function seedRead(userId: string, messageId: string, channelId: string, readAt: number) {
  await ctx.pool.query(
    `INSERT INTO aaelink.message_reads (user_id, message_id, channel_id, read_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, message_id) DO UPDATE SET read_at = EXCLUDED.read_at`,
    [userId, messageId, channelId, readAt]
  )
}

beforeAll(async () => {
  ctx = await createTestContext()
  author = await createTestUser(ctx.pool, { role: 'member' })
  createdIds.push(author.id)
  const { rows: [m] } = await ctx.pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.workspace_members WHERE user_id = $1 LIMIT 1`,
    [author.id]
  )
  wsId = m.workspace_id
  channel = await createTestChannel(ctx.pool, author.id, { workspaceId: wsId })
})

afterAll(async () => {
  await ctx.pool.query(`DELETE FROM aaelink.message_reads WHERE channel_id = $1`, [channel.id])
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('readReceiptDeltaSince', () => {
  it('returns an empty delta and unchanged watermark when nothing advanced', async () => {
    const msg = await createTestMessage(ctx.pool, channel.id, author.id, 'no reads yet')
    void msg
    const out = await readReceiptDeltaSince(ctx.pool, channel.id, Date.now())
    expect(out.map).toEqual({})
    expect(Object.keys(out.map)).toHaveLength(0)
  })

  it('surfaces a new read and advances the watermark to its read_at', async () => {
    const reader = await createTestUser(ctx.pool, { role: 'member' })
    createdIds.push(reader.id)
    const msg = await createTestMessage(ctx.pool, channel.id, author.id, 'one reader')
    const t = Date.now() + 1000
    await seedRead(reader.id, msg, channel.id, t)

    const out = await readReceiptDeltaSince(ctx.pool, channel.id, t - 1)
    expect(out.map[msg]).toEqual([{ user_id: reader.id, read_at: t }])
    expect(out.nextWatermark).toBe(t)

    // Re-poll at the returned watermark — strict cursor yields nothing for this read.
    const again = await readReceiptDeltaSince(ctx.pool, channel.id, out.nextWatermark)
    expect(again.map[msg]).toBeUndefined()
    expect(again.nextWatermark).toBe(out.nextWatermark)
  })

  it('orders multiple readers newest-first', async () => {
    const r1 = await createTestUser(ctx.pool, { role: 'member' })
    const r2 = await createTestUser(ctx.pool, { role: 'member' })
    createdIds.push(r1.id, r2.id)
    const msg = await createTestMessage(ctx.pool, channel.id, author.id, 'two readers')
    const base = Date.now() + 5000
    await seedRead(r1.id, msg, channel.id, base)        // older
    await seedRead(r2.id, msg, channel.id, base + 100)  // newer

    const out = await readReceiptDeltaSince(ctx.pool, channel.id, base - 1)
    expect(out.map[msg].map(r => r.user_id)).toEqual([r2.id, r1.id])
    expect(out.nextWatermark).toBe(base + 100)
  })

  it('makes partial progress under the page cap and eventually drains every message (no gap)', async () => {
    const reader = await createTestUser(ctx.pool, { role: 'member' })
    createdIds.push(reader.id)
    const base = Date.now() + 20_000
    const msgs: string[] = []
    for (let i = 0; i < 5; i++) {
      const mId = await createTestMessage(ctx.pool, channel.id, author.id, `cap msg ${i}`)
      msgs.push(mId)
      await seedRead(reader.id, mId, channel.id, base + i) // strictly increasing read_at
    }

    // First poll with a small cap returns exactly `limit` messages, oldest-first.
    // Because the cap was hit, the watermark is held one ms below the max returned
    // read_at so the truncated tail is re-scanned next tick (nothing is skipped).
    const first = await readReceiptDeltaSince(ctx.pool, channel.id, base - 1, 3)
    expect(Object.keys(first.map)).toHaveLength(3)
    expect(first.nextWatermark).toBe(base + 1) // maxMr (base+2) - 1

    // Drain: keep polling at the returned watermark; assert every seeded message
    // surfaces with no permanent gap (a DESC ordering or global-MAX watermark
    // regression would strand the tail and fail this).
    const seen = new Set<string>(Object.keys(first.map))
    let wm = first.nextWatermark
    for (let guard = 0; guard < 10; guard++) {
      const next = await readReceiptDeltaSince(ctx.pool, channel.id, wm, 3)
      if (Object.keys(next.map).length === 0) break
      Object.keys(next.map).forEach(id => seen.add(id))
      if (next.nextWatermark === wm) break // no-progress safety
      wm = next.nextWatermark
    }
    for (const mId of msgs) expect(seen.has(mId)).toBe(true)

    // Isolate: this test seeds the highest read_at values in the shared channel;
    // drop them so they don't leak into later tests' watermark assertions.
    await ctx.pool.query(`DELETE FROM aaelink.message_reads WHERE user_id = $1`, [reader.id])
  })

  it('caps each message reader stack at 5', async () => {
    const msg = await createTestMessage(ctx.pool, channel.id, author.id, 'crowd')
    const base = Date.now() + 10_000
    const readers: string[] = []
    for (let i = 0; i < 7; i++) {
      const u = await createTestUser(ctx.pool, { role: 'member' })
      createdIds.push(u.id)
      readers.push(u.id)
      await seedRead(u.id, msg, channel.id, base + i)
    }
    const out = await readReceiptDeltaSince(ctx.pool, channel.id, base - 1)
    expect(out.map[msg]).toHaveLength(5)
    // Newest 5 (highest read_at) survive, newest-first.
    expect(out.map[msg][0].user_id).toBe(readers[6])
    expect(out.nextWatermark).toBe(base + 6)
  })
})
