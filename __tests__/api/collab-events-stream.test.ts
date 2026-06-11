/**
 * Integration tests: `GET /api/collab/events` SSE stream — read-cursor plumbing.
 *
 * Exercises the route-level stream behaviour that the helper tests in
 * `read-receipt-delta.test.ts` cannot reach:
 *   - a baseline `read_cursor` frame is emitted at stream start (first-connect
 *     seeds it from MAX(read_at) of the channel)
 *   - `read_since` overrides the baseline so reads that landed during a
 *     disconnect gap are re-streamed with the advanced `read_cursor` echoed
 *   - aborting the request closes the stream (the route's interval is cleared
 *     by the 'abort' listener, so nothing leaks past the test)
 *
 * Uses the abortable `asRequest({ signal })` — without it the route's
 * setInterval would outlive the test.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext, createTestUser, createTestChannel, createTestMessage,
  cleanupTestData, asRequest, TestContext, TestUser, TestChannel,
} from '../helpers'
import { GET } from '@/app/api/collab/events/route'
import { stopScheduledMessageProcessor } from '@/lib/infra/scheduledMessageProcessor'

let ctx: TestContext
let author: TestUser
let reader: TestUser
let channel: TestChannel
let wsId: string
const createdIds: string[] = []
const channelIds: string[] = []

/**
 * Per-test channel in the shared workspace, tracked for teardown. Streaming
 * tests each get their own channel so the baseline MAX(read_at) assertion in
 * one test cannot be perturbed by reads another test seeded (no declaration-
 * order coupling).
 */
async function newChannel(type: 'public' | 'private' = 'public'): Promise<TestChannel> {
  const ch = await createTestChannel(ctx.pool, author.id, { workspaceId: wsId, type })
  channelIds.push(ch.id)
  return ch
}

async function seedRead(userId: string, messageId: string, channelId: string, readAt: number) {
  await ctx.pool.query(
    `INSERT INTO aaelink.message_reads (user_id, message_id, channel_id, read_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, message_id) DO UPDATE SET read_at = EXCLUDED.read_at`,
    [userId, messageId, channelId, readAt]
  )
}

type SseFrame = {
  posts?: unknown[]
  read_receipts?: Record<string, { user_id: string; read_at: number }[]>
  read_cursor?: number
}

/**
 * Read SSE `data:` frames off the response until `count` frames arrived or the
 * stream ended. Comment frames (`: ping`) are skipped. Multiple frames may
 * arrive in one chunk; partial frames are buffered across reads.
 */
async function readFrames(res: Response, count: number): Promise<SseFrame[]> {
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  const frames: SseFrame[] = []
  let buf = ''
  try {
    while (frames.length < count) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const chunk = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        if (chunk.startsWith('data: ')) frames.push(JSON.parse(chunk.slice(6)) as SseFrame)
      }
    }
  } finally {
    reader.releaseLock()
  }
  return frames
}

/** Drain the stream after an abort; resolves true when it closed. */
async function streamClosed(res: Response): Promise<boolean> {
  const reader = res.body!.getReader()
  try {
    for (let guard = 0; guard < 10; guard++) {
      const { done } = await reader.read()
      if (done) return true
    }
    return false
  } finally {
    reader.releaseLock()
  }
}

beforeAll(async () => {
  ctx = await createTestContext()
  author = await createTestUser(ctx.pool, { role: 'member' })
  reader = await createTestUser(ctx.pool, { role: 'member' })
  createdIds.push(author.id, reader.id)
  const { rows: [m] } = await ctx.pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.workspace_members WHERE user_id = $1 LIMIT 1`,
    [author.id]
  )
  wsId = m.workspace_id
  channel = await newChannel()
})

afterAll(async () => {
  // The route module starts the scheduled-message processor on import; stop its
  // 10s interval so the worker can exit.
  stopScheduledMessageProcessor()
  // cleanupTestData only cascades channels of non-system workspaces; these live
  // in the shared system workspace, so drop their rows explicitly.
  await ctx.pool.query(`DELETE FROM aaelink.message_reads WHERE channel_id = ANY($1)`, [channelIds])
  await ctx.pool.query(`DELETE FROM aaelink.messages WHERE channel_id = ANY($1)`, [channelIds])
  await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = ANY($1)`, [channelIds])
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('GET /api/collab/events — read-cursor stream plumbing', () => {
  it('emits a baseline read_cursor frame seeded from MAX(read_at) on first connect, and abort closes the stream', async () => {
    const ch = await newChannel()
    const msg = await createTestMessage(ctx.pool, ch.id, author.id, 'baseline read')
    const t = Date.now() - 60_000
    await seedRead(reader.id, msg, ch.id, t)

    const ac = new AbortController()
    const res = await GET(asRequest('GET', '/api/collab/events', {
      cookie: author.sessionCookie,
      query: { channel_id: ch.id },
      signal: ac.signal,
    }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    // First frame is the baseline cursor — no read_since, so it seeds from the
    // channel's latest existing read (the initial stacks come with the message
    // load, the stream only carries subsequent changes).
    const [baseline] = await readFrames(res, 1)
    expect(baseline).toEqual({ read_cursor: t })

    ac.abort()
    expect(await streamClosed(res)).toBe(true)
  })

  it('resumes from read_since: gap reads are re-streamed and the advanced cursor echoed', async () => {
    const ch = await newChannel()
    const msg = await createTestMessage(ctx.pool, ch.id, author.id, 'gap read')
    const t = Date.now() - 30_000
    await seedRead(reader.id, msg, ch.id, t)

    // Client reconnects holding the cursor it had before the gap read landed.
    const ac = new AbortController()
    const res = await GET(asRequest('GET', '/api/collab/events', {
      cookie: author.sessionCookie,
      query: { channel_id: ch.id, read_since: String(t - 1) },
      signal: ac.signal,
    }))
    expect(res.status).toBe(200)

    const frames = await readFrames(res, 2)
    // Baseline echoes the resumed cursor, not MAX(read_at).
    expect(frames[0]).toEqual({ read_cursor: t - 1 })
    // First tick delivers the read that landed during the gap and advances the cursor.
    expect(frames[1].read_receipts?.[msg]).toEqual([{ user_id: reader.id, read_at: t }])
    expect(frames[1].read_cursor).toBe(t)

    ac.abort()
    expect(await streamClosed(res)).toBe(true)
  })

  it('rejects an unauthenticated stream with 401 (no stream opened)', async () => {
    const res = await GET(asRequest('GET', '/api/collab/events', {
      query: { channel_id: channel.id },
    }))
    expect(res.status).toBe(401)
  })

  it('rejects a workspace member without channel membership on a private channel with 403', async () => {
    const outsider = await createTestUser(ctx.pool, { role: 'member' })
    createdIds.push(outsider.id)
    // Open ('O') channels are readable by any workspace member, so the gate
    // only bites on a private channel the outsider was never added to.
    const priv = await newChannel('private')
    const res = await GET(asRequest('GET', '/api/collab/events', {
      cookie: outsider.sessionCookie,
      query: { channel_id: priv.id },
    }))
    expect(res.status).toBe(403)
  })
})
