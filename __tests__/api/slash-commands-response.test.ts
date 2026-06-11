/**
 * Integration tests for POST /api/slash-commands/response
 *
 * Slack parity §14 — slash command delayed responses (response_url). The
 * receiver validates a signed, single-channel-scoped, expiring token (minted at
 * dispatch by lib/comms/slashResponseToken.mintResponseToken) and delivers a
 * Slack-shaped { response_type, text } message into the bound channel via the
 * canonical message-create + redisPubSub realtime path.
 *
 * These tests fail if the enforcement is removed:
 *   - expiry check removed  → expired-token case would 2xx
 *   - use-cap removed       → 6th use would succeed
 *   - signature check removed → tampered token would 2xx
 *   - in_channel persistence removed → no message row appears
 *   - ephemeral persistence added → an ephemeral row would wrongly appear
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext, createTestUser, createTestChannel, asRequest,
  cleanupTestData,
  TestContext, TestUser, TestChannel,
} from '../helpers'
import { mintResponseToken, RESPONSE_TOKEN_TTL_MS } from '@/lib/comms/slashResponseToken'

let ctx: TestContext
let user: TestUser
let channel: TestChannel
const createdIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(user.id)
  channel = await createTestChannel(ctx.pool, user.id)
})

afterAll(async () => {
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

async function workspaceIdForChannel(channelId: string): Promise<string> {
  const { rows } = await ctx.pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.channels WHERE id = $1`, [channelId]
  )
  return rows[0]?.workspace_id || ''
}

function postResponse(token: string, body: Record<string, unknown>) {
  return import('@/app/api/slash-commands/response/route').then(({ POST }) =>
    POST(asRequest('POST', '/api/slash-commands/response', {
      query: { token },
      body,
      noAutoCsrf: true, // token-authenticated inbound endpoint; no session/CSRF
    }))
  )
}

async function messageCount(channelId: string): Promise<number> {
  const { rows } = await ctx.pool.query<{ n: string }>(
    `SELECT COUNT(*)::int AS n FROM aaelink.messages WHERE channel_id = $1`, [channelId]
  )
  return Number(rows[0]?.n || 0)
}

// ── 1. valid token posts a delayed in_channel message ───────────────────────

describe('POST /api/slash-commands/response — valid token (in_channel)', () => {
  it('persists a real channel message and returns ok', async () => {
    const wsId = await workspaceIdForChannel(channel.id)
    const token = await mintResponseToken(ctx.pool, {
      channelId: channel.id, userId: user.id, command: 'deploy', workspaceId: wsId,
    })
    const before = await messageCount(channel.id)

    const res = await postResponse(token, { response_type: 'in_channel', text: 'delayed reply' })
    expect(res.status).toBe(200)
    const json = await res.json() as { ok: boolean; response_type: string; message_id: string }
    expect(json.ok).toBe(true)
    expect(json.response_type).toBe('in_channel')

    const after = await messageCount(channel.id)
    expect(after).toBe(before + 1)

    const { rows } = await ctx.pool.query<{ body: string }>(
      `SELECT body FROM aaelink.messages WHERE id = $1`, [json.message_id]
    )
    expect(rows[0]?.body).toBe('delayed reply')
  })
})

// ── 2. expired token → 401 ──────────────────────────────────────────────────

describe('POST /api/slash-commands/response — expired token', () => {
  it('rejects with 401 token_expired and posts nothing', async () => {
    const wsId = await workspaceIdForChannel(channel.id)
    // ttl in the past so the row is born expired
    const token = await mintResponseToken(ctx.pool, {
      channelId: channel.id, userId: user.id, command: 'deploy', workspaceId: wsId,
    }, -1000)
    const before = await messageCount(channel.id)

    const res = await postResponse(token, { response_type: 'in_channel', text: 'too late' })
    expect(res.status).toBe(401)
    const json = await res.json() as { error: string }
    expect(json.error).toBe('token_expired')

    expect(await messageCount(channel.id)).toBe(before)
  })
})

// ── 3. >5 uses rejected ─────────────────────────────────────────────────────

describe('POST /api/slash-commands/response — use cap (max 5)', () => {
  it('allows 5 uses then rejects the 6th as token_exhausted', async () => {
    const wsId = await workspaceIdForChannel(channel.id)
    const token = await mintResponseToken(ctx.pool, {
      channelId: channel.id, userId: user.id, command: 'deploy', workspaceId: wsId,
    })

    for (let i = 1; i <= 5; i++) {
      const res = await postResponse(token, { response_type: 'in_channel', text: `use ${i}` })
      expect(res.status).toBe(200)
    }

    const sixth = await postResponse(token, { response_type: 'in_channel', text: 'use 6' })
    expect(sixth.status).toBe(429)
    const json = await sixth.json() as { error: string }
    expect(json.error).toBe('token_exhausted')
  })
})

// ── 4. tampered token → 401 ─────────────────────────────────────────────────

describe('POST /api/slash-commands/response — tampered token', () => {
  it('rejects a token with a mutated signature (401 invalid_token)', async () => {
    const wsId = await workspaceIdForChannel(channel.id)
    const token = await mintResponseToken(ctx.pool, {
      channelId: channel.id, userId: user.id, command: 'deploy', workspaceId: wsId,
    })
    // Flip the last hex char of the signature half.
    const dot = token.indexOf('.')
    const sig = token.slice(dot + 1)
    const lastChar = sig.slice(-1)
    const flipped = (lastChar === 'a' ? 'b' : 'a')
    const tampered = `${token.slice(0, dot)}.${sig.slice(0, -1)}${flipped}`

    const before = await messageCount(channel.id)
    const res = await postResponse(tampered, { response_type: 'in_channel', text: 'forged' })
    expect(res.status).toBe(401)
    const json = await res.json() as { error: string }
    expect(json.error).toBe('invalid_token')
    expect(await messageCount(channel.id)).toBe(before)
  })

  it('rejects a token whose row id is swapped (binding broken)', async () => {
    const wsId = await workspaceIdForChannel(channel.id)
    const a = await mintResponseToken(ctx.pool, {
      channelId: channel.id, userId: user.id, command: 'deploy', workspaceId: wsId,
    })
    const b = await mintResponseToken(ctx.pool, {
      channelId: channel.id, userId: user.id, command: 'deploy', workspaceId: wsId,
    })
    // Use A's row id with B's signature — signature no longer matches the row.
    const forged = `${a.slice(0, a.indexOf('.'))}.${b.slice(b.indexOf('.') + 1)}`
    const res = await postResponse(forged, { response_type: 'in_channel', text: 'x' })
    expect(res.status).toBe(401)
  })
})

// ── 5. ephemeral vs in_channel honored ──────────────────────────────────────

describe('POST /api/slash-commands/response — response_type honored', () => {
  it('ephemeral does NOT persist a channel message', async () => {
    const wsId = await workspaceIdForChannel(channel.id)
    const token = await mintResponseToken(ctx.pool, {
      channelId: channel.id, userId: user.id, command: 'deploy', workspaceId: wsId,
    })
    const before = await messageCount(channel.id)

    const res = await postResponse(token, { response_type: 'ephemeral', text: 'only for you' })
    expect(res.status).toBe(200)
    const json = await res.json() as { ok: boolean; response_type: string }
    expect(json.ok).toBe(true)
    expect(json.response_type).toBe('ephemeral')

    // Ephemeral is realtime-only — no durable row.
    expect(await messageCount(channel.id)).toBe(before)
  })

  it('defaults to ephemeral when response_type is absent/unknown', async () => {
    const wsId = await workspaceIdForChannel(channel.id)
    const token = await mintResponseToken(ctx.pool, {
      channelId: channel.id, userId: user.id, command: 'deploy', workspaceId: wsId,
    })
    const before = await messageCount(channel.id)
    const res = await postResponse(token, { response_type: 'bogus', text: 'hi' })
    expect(res.status).toBe(200)
    const json = await res.json() as { response_type: string }
    expect(json.response_type).toBe('ephemeral')
    expect(await messageCount(channel.id)).toBe(before)
  })
})

// ── token plumbing sanity ───────────────────────────────────────────────────

describe('response token TTL constant', () => {
  it('defaults to ~30 minutes', () => {
    expect(RESPONSE_TOKEN_TTL_MS).toBe(30 * 60 * 1000)
  })
})

// ── missing token guard ─────────────────────────────────────────────────────

describe('POST /api/slash-commands/response — missing token', () => {
  it('returns 401 token_required', async () => {
    const { POST } = await import('@/app/api/slash-commands/response/route')
    const res = await POST(asRequest('POST', '/api/slash-commands/response', {
      body: { text: 'x' }, noAutoCsrf: true,
    }))
    expect(res.status).toBe(401)
    const json = await res.json() as { error: string }
    expect(json.error).toBe('token_required')
  })
})
