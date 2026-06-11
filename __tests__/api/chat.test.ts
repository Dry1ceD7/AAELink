/**
 * Integration tests for POST /api/chat
 *
 * Regression coverage for the phantom `content` column bug — every action that
 * previously inserted/updated using the non-existent `content` column (or the
 * non-existent `scheduled_at` column) now exercises the corrected `body` /
 * `send_at` column names against a real database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, createTestChannel, asRequest,
  cleanupTestData,
  TestContext, TestUser,
} from '../helpers'

let ctx: TestContext
let user: TestUser
const createdIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(user.id)
})

afterAll(async () => {
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

// ── Auth guard ──────────────────────────────────────────────────────────────

describe('POST /api/chat — auth', () => {
  it('returns 401 without session', async () => {
    const { POST } = await import('@/app/api/chat/route')
    const req = asRequest('POST', '/api/chat', {
      body: { action: 'postMessage', channel: 'x', text: 'hi' },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })
})

// ── postMessage — regression: phantom `content` + `type` columns ───────────

describe('POST /api/chat — postMessage', () => {
  it('inserts a message and returns ok (regression: body column, not content)', async () => {
    const { POST } = await import('@/app/api/chat/route')
    const channel = await createTestChannel(ctx.pool, user.id)

    const req = asRequest('POST', '/api/chat', {
      cookie: user.sessionCookie,
      body: { action: 'postMessage', channel: channel.id, text: 'hello world' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.channel).toBe(channel.id)
    expect(typeof json.ts).toBe('string')

    // Verify the row landed with the correct `body` column
    const { rows } = await ctx.pool.query(
      `SELECT body FROM aaelink.messages WHERE channel_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [channel.id]
    )
    expect(rows[0]?.body).toBe('hello world')

    // Cleanup
    await ctx.pool.query(`DELETE FROM aaelink.messages WHERE channel_id = $1`, [channel.id])
    await ctx.pool.query(`DELETE FROM aaelink.channel_members WHERE channel_id = $1`, [channel.id])
    await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = $1`, [channel.id])
  })

  it('returns 400 when channel or text missing', async () => {
    const { POST } = await import('@/app/api/chat/route')
    const req = asRequest('POST', '/api/chat', {
      cookie: user.sessionCookie,
      body: { action: 'postMessage', text: 'no channel' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})

// ── update — regression: phantom `content` column in SET clause ─────────────

describe('POST /api/chat — update', () => {
  it('updates message body (regression: SET body, not SET content)', async () => {
    const { POST } = await import('@/app/api/chat/route')
    const channel = await createTestChannel(ctx.pool, user.id)
    const msgId = randomUUID()
    const now = Date.now()

    await ctx.pool.query(
      `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'original', '', $4, $4)`,
      [msgId, channel.id, user.id, now]
    )

    const req = asRequest('POST', '/api/chat', {
      cookie: user.sessionCookie,
      body: { action: 'update', channel: channel.id, ts: msgId, text: 'edited' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)

    const { rows } = await ctx.pool.query(
      `SELECT body FROM aaelink.messages WHERE id = $1`, [msgId]
    )
    expect(rows[0]?.body).toBe('edited')

    // Cleanup
    await ctx.pool.query(`DELETE FROM aaelink.messages WHERE id = $1`, [msgId])
    await ctx.pool.query(`DELETE FROM aaelink.channel_members WHERE channel_id = $1`, [channel.id])
    await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = $1`, [channel.id])
  })
})

// ── meMessage — regression: phantom `content` + `type` columns ─────────────

describe('POST /api/chat — meMessage', () => {
  it('inserts a me_message using body column (regression)', async () => {
    const { POST } = await import('@/app/api/chat/route')
    const channel = await createTestChannel(ctx.pool, user.id)

    const req = asRequest('POST', '/api/chat', {
      cookie: user.sessionCookie,
      body: { action: 'meMessage', channel: channel.id, text: '/me waves' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)

    const { rows } = await ctx.pool.query(
      `SELECT body FROM aaelink.messages WHERE channel_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [channel.id]
    )
    expect(rows[0]?.body).toBe('/me waves')

    // Cleanup
    await ctx.pool.query(`DELETE FROM aaelink.messages WHERE channel_id = $1`, [channel.id])
    await ctx.pool.query(`DELETE FROM aaelink.channel_members WHERE channel_id = $1`, [channel.id])
    await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = $1`, [channel.id])
  })
})

// ── scheduleMessage — regression: phantom `content` + `scheduled_at` ────────

describe('POST /api/chat — scheduleMessage', () => {
  it('inserts into scheduled_messages using body/send_at (regression)', async () => {
    const { POST } = await import('@/app/api/chat/route')
    const channel = await createTestChannel(ctx.pool, user.id)
    const postAt = Date.now() + 60_000

    const req = asRequest('POST', '/api/chat', {
      cookie: user.sessionCookie,
      body: { action: 'scheduleMessage', channel: channel.id, text: 'future msg', post_at: postAt },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(typeof json.scheduled_message_id).toBe('string')

    const { rows } = await ctx.pool.query(
      `SELECT body, send_at FROM aaelink.scheduled_messages WHERE id = $1`,
      [json.scheduled_message_id]
    )
    expect(rows[0]?.body).toBe('future msg')
    expect(Number(rows[0]?.send_at)).toBe(postAt)

    // Cleanup
    await ctx.pool.query(`DELETE FROM aaelink.scheduled_messages WHERE id = $1`, [json.scheduled_message_id])
    await ctx.pool.query(`DELETE FROM aaelink.channel_members WHERE channel_id = $1`, [channel.id])
    await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = $1`, [channel.id])
  })
})

// ── postEphemeral — not persisted, returns ok ───────────────────────────────

describe('POST /api/chat — postEphemeral', () => {
  it('returns ok without persisting (ephemeral)', async () => {
    const { POST } = await import('@/app/api/chat/route')
    const channel = await createTestChannel(ctx.pool, user.id)

    const req = asRequest('POST', '/api/chat', {
      cookie: user.sessionCookie,
      body: { action: 'postEphemeral', channel: channel.id, text: 'only you see this', user: user.id },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(typeof json.message_ts).toBe('string')

    // Confirm nothing persisted
    const { rows } = await ctx.pool.query(
      `SELECT id FROM aaelink.messages WHERE channel_id = $1`, [channel.id]
    )
    expect(rows).toHaveLength(0)

    // Cleanup
    await ctx.pool.query(`DELETE FROM aaelink.channel_members WHERE channel_id = $1`, [channel.id])
    await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = $1`, [channel.id])
  })
})
