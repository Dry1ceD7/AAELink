/**
 * Integration tests: public incoming-webhook receiver
 * (app/api/webhooks/[token]/route.ts — Integrations parity §2 + §3).
 *
 * Covers the gaps in parity-reference-matrix.md:341-342:
 *   - valid-signature POST posts a message AND emits via redisPubSub
 *   - bad-signature POST → 401 invalid_signature (enforcement removed → test fails)
 *   - no-secret legacy webhook still posts (open back-compat path)
 *   - Slack-compatible attachments + blocks are stored on the message metadata
 *   - malformed Block Kit blocks are rejected (400 invalid_blocks)
 *
 * The receiver verifies the SAME v0 HMAC-SHA256 scheme used for OUTBOUND
 * webhooks (lib/webhooks/webhookSigning.ts), so the test signs with signPayload.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, createTestChannel,
  cleanupTestData, TestContext, TestUser, TestChannel,
} from '../helpers'
import { NextRequest } from 'next/server'
import { signPayload } from '@/lib/webhooks/webhookSigning'
import { getPubSub, channelTopic, type PubSubEvent } from '@/lib/realtime/redisPubSub'

let ctx: TestContext
let user: TestUser
let channel: TestChannel
let wsId: string
const SECRET = 'whsec_test_inbound_secret_value'
const createdIds: string[] = []
const createdWebhookIds: string[] = []

/** Build a raw POST request to the receiver with an explicit raw JSON body. */
function rawPost(token: string, rawBody: string, headers: Record<string, string> = {}): NextRequest {
  const h = new Headers({ 'content-type': 'application/json', ...headers })
  return new NextRequest(new URL(`/api/webhooks/${token}`, 'http://localhost:3040'), {
    method: 'POST',
    headers: h,
    body: rawBody,
  })
}

async function seedWebhook(signingSecret: string): Promise<{ id: string; token: string }> {
  const id = randomUUID()
  const token = `tok_${randomUUID().replace(/-/g, '')}`
  await ctx.pool.query(
    `INSERT INTO aaelink.incoming_webhooks
       (id, workspace_id, app_id, channel_id, name, secret_token, signing_secret, created_by, created_at)
     VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8)`,
    [id, wsId, channel.id, `recv-hook-${id.slice(0, 8)}`, token, signingSecret, user.id, Date.now()]
  )
  createdWebhookIds.push(id)
  return { id, token }
}

async function messageCount(channelId: string): Promise<number> {
  const { rows } = await ctx.pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM aaelink.messages WHERE channel_id = $1`, [channelId]
  )
  return Number(rows[0].n)
}

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(user.id)
  const { rows: [m] } = await ctx.pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.workspace_members WHERE user_id = $1 LIMIT 1`, [user.id]
  )
  wsId = m.workspace_id
  channel = await createTestChannel(ctx.pool, user.id, { workspaceId: wsId })
})

afterAll(async () => {
  if (createdWebhookIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.incoming_webhooks WHERE id = ANY($1)`, [createdWebhookIds])
  }
  await ctx.pool.query(`DELETE FROM aaelink.audit_log WHERE workspace_id = $1`, [wsId])
  await ctx.pool.query(`DELETE FROM aaelink.messages WHERE channel_id = $1`, [channel.id])
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('incoming-webhook receiver — signature verification', () => {
  it('valid signature posts a message AND emits via redisPubSub', async () => {
    const { id, token } = await seedWebhook(SECRET)
    const { POST } = await import('@/app/api/webhooks/[token]/route')

    const rawBody = JSON.stringify({ text: 'signed hello' })
    const { headers } = signPayload(SECRET, rawBody)

    // Capture the realtime emit on this channel's topic.
    const received: PubSubEvent[] = []
    const unsub = getPubSub().subscribe(channelTopic(channel.id), e => received.push(e))

    const before = await messageCount(channel.id)
    const res = await POST(rawPost(token, rawBody, headers), { params: Promise.resolve({ token }) })
    unsub()

    expect(res.status).toBe(200)
    const data = await res.json() as { success: boolean; message_id: string }
    expect(data.success).toBe(true)
    expect(await messageCount(channel.id)).toBe(before + 1)

    // Realtime emit happened with the message payload.
    const emitted = received.find(e => e.type === 'message') as
      | { type: 'message'; channel_id: string; payload: { id: string } }
      | undefined
    expect(emitted).toBeTruthy()
    expect(emitted!.channel_id).toBe(channel.id)
    expect(emitted!.payload.id).toBe(data.message_id)

    // Stored message carries bot identity in metadata.
    const { rows } = await ctx.pool.query<{ body: string; metadata: { is_bot: boolean; webhook_id: string } }>(
      `SELECT body, metadata FROM aaelink.messages WHERE id = $1`, [data.message_id]
    )
    expect(rows[0].body).toBe('signed hello')
    expect(rows[0].metadata.is_bot).toBe(true)
    expect(rows[0].metadata.webhook_id).toBe(id)
  })

  it('rejects a bad signature with 401 (enforcement is real)', async () => {
    const { token } = await seedWebhook(SECRET)
    const { POST } = await import('@/app/api/webhooks/[token]/route')

    const rawBody = JSON.stringify({ text: 'forged' })
    // Sign with the WRONG secret — header present but invalid.
    const { headers } = signPayload('whsec_wrong_secret', rawBody)

    const before = await messageCount(channel.id)
    const res = await POST(rawPost(token, rawBody, headers), { params: Promise.resolve({ token }) })
    expect(res.status).toBe(401)
    const data = await res.json() as { error: string }
    expect(data.error).toBe('invalid_signature')
    // Nothing was persisted.
    expect(await messageCount(channel.id)).toBe(before)
  })

  it('rejects a missing signature on a secured webhook (401)', async () => {
    const { token } = await seedWebhook(SECRET)
    const { POST } = await import('@/app/api/webhooks/[token]/route')
    const rawBody = JSON.stringify({ text: 'no sig' })
    const res = await POST(rawPost(token, rawBody), { params: Promise.resolve({ token }) })
    expect(res.status).toBe(401)
    const data = await res.json() as { error: string }
    expect(data.error).toBe('invalid_signature')
  })
})

describe('incoming-webhook receiver — legacy open path', () => {
  it('a webhook with no signing secret still posts (back-compat)', async () => {
    const { token } = await seedWebhook('') // open webhook
    const { POST } = await import('@/app/api/webhooks/[token]/route')
    const rawBody = JSON.stringify({ text: 'legacy unsigned' })

    const before = await messageCount(channel.id)
    const res = await POST(rawPost(token, rawBody), { params: Promise.resolve({ token }) })
    expect(res.status).toBe(200)
    const data = await res.json() as { success: boolean; message_id: string }
    expect(data.success).toBe(true)
    expect(await messageCount(channel.id)).toBe(before + 1)
  })

  it('rejects an unknown token with 401', async () => {
    const { POST } = await import('@/app/api/webhooks/[token]/route')
    const rawBody = JSON.stringify({ text: 'x' })
    const res = await POST(rawPost('does-not-exist', rawBody), {
      params: Promise.resolve({ token: 'does-not-exist' }),
    })
    expect(res.status).toBe(401)
    const data = await res.json() as { error: string }
    expect(data.error).toBe('invalid_webhook_token')
  })
})

describe('incoming-webhook receiver — Slack-compatible payload', () => {
  it('stores attachments and valid blocks on the message metadata', async () => {
    const { token } = await seedWebhook('') // open for simplicity
    const { POST } = await import('@/app/api/webhooks/[token]/route')

    const payload = {
      text: 'rich message',
      username: 'Jira Bot',
      icon_url: 'https://example.test/jira.png',
      attachments: [{ color: '#36a64f', text: 'an attachment' }],
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: 'Release 1.2' } },
        { type: 'section', text: { type: 'mrkdwn', text: '*All green*' } },
      ],
    }
    const rawBody = JSON.stringify(payload)
    const res = await POST(rawPost(token, rawBody), { params: Promise.resolve({ token }) })
    expect(res.status).toBe(200)
    const data = await res.json() as { message_id: string }

    const { rows } = await ctx.pool.query<{
      body: string
      metadata: { bot_name: string; bot_icon: string; attachments?: unknown[]; blocks?: unknown[] }
    }>(`SELECT body, metadata FROM aaelink.messages WHERE id = $1`, [data.message_id])
    const md = rows[0].metadata
    expect(rows[0].body).toBe('rich message')
    expect(md.bot_name).toBe('Jira Bot')
    expect(md.bot_icon).toBe('https://example.test/jira.png')
    expect(Array.isArray(md.attachments)).toBe(true)
    expect(md.attachments!.length).toBe(1)
    expect(Array.isArray(md.blocks)).toBe(true)
    expect(md.blocks!.length).toBe(2)
  })

  it('accepts a blocks-only message (no text)', async () => {
    const { token } = await seedWebhook('')
    const { POST } = await import('@/app/api/webhooks/[token]/route')
    const rawBody = JSON.stringify({
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'blocks only' } }],
    })
    const res = await POST(rawPost(token, rawBody), { params: Promise.resolve({ token }) })
    expect(res.status).toBe(200)
  })

  it('rejects malformed Block Kit blocks with 400 invalid_blocks', async () => {
    const { token } = await seedWebhook('')
    const { POST } = await import('@/app/api/webhooks/[token]/route')
    // header requires a plain_text text object; an unknown block type + a header
    // missing its text are structurally invalid.
    const rawBody = JSON.stringify({
      text: 'ignored',
      blocks: [{ type: 'not_a_real_block' }, { type: 'header' }],
    })
    const before = await messageCount(channel.id)
    const res = await POST(rawPost(token, rawBody), { params: Promise.resolve({ token }) })
    expect(res.status).toBe(400)
    const data = await res.json() as { error: string }
    expect(data.error).toBe('invalid_blocks')
    expect(await messageCount(channel.id)).toBe(before)
  })

  it('rejects an empty payload with 400', async () => {
    const { token } = await seedWebhook('')
    const { POST } = await import('@/app/api/webhooks/[token]/route')
    const res = await POST(rawPost(token, JSON.stringify({})), { params: Promise.resolve({ token }) })
    expect(res.status).toBe(400)
    const data = await res.json() as { error: string }
    expect(data.error).toBe('empty_payload')
  })
})
