// keep: slack-compat surface — inbound delayed-response (response_url) receiver.
import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { validateAndConsume } from '@/lib/comms/slashResponseToken'
import { deliverScheduledMessage } from '@/lib/messaging/deliverScheduledMessage'
import { getPubSub, userTopic } from '@/lib/realtime/redisPubSub'
import type { Pool } from 'pg'

/**
 * Slash command delayed-response receiver (Slack parity §14 — response_url).
 *
 * POST /api/slash-commands/response?token=<rowId>.<hmac>
 *
 * This is an INBOUND, machine-to-machine endpoint. The external app that
 * received a dispatched slash command POSTs Slack-shaped responses here using
 * the response_url it was handed. Authentication is the signed, single-channel-
 * scoped, expiring token (NOT a session/CSRF) — it binds the target channel,
 * user, command and workspace and is good for up to 5 uses within ~30 min.
 *
 * Body: { response_type?: 'in_channel' | 'ephemeral', text?: string, blocks?: [] }
 *   - in_channel: persisted as a real channel message via the shared
 *     deliverScheduledMessage() path (message-create + redisPubSub realtime).
 *   - ephemeral:  NOT persisted; pushed only to the bound user's realtime topic.
 *
 * No SSRF surface (inbound). Replay-safe via the token's atomic use counter.
 */

/** Slack response bodies may carry blocks; we store a compact text projection. */
type ResponseBody = {
  response_type?: string
  text?: string
  blocks?: unknown[]
}

/** Best-effort audit row for a delayed-response delivery (must not throw). */
async function auditResponse(
  pool: Pool,
  opts: { workspaceId: string; userId: string; command: string; channelId: string; responseType: string; status: string },
) {
  try {
    await pool.query(
      `INSERT INTO aaelink.audit_log (id, workspace_id, actor_id, action, resource_kind, resource_id, metadata, created_at)
       VALUES ($1, $2, $3, 'slash_command.response', 'channel', $4, $5, $6)`,
      [
        randomUUID(),
        opts.workspaceId,
        opts.userId,
        opts.channelId,
        JSON.stringify({
          command: `/${opts.command}`,
          channel_id: opts.channelId,
          response_type: opts.responseType,
          status: opts.status,
        }),
        Date.now(),
      ],
    )
  } catch { /* audit log is best-effort */ }
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const token = req.nextUrl.searchParams.get('token')?.trim() || ''
  if (!token) return NextResponse.json({ error: 'token_required' }, { status: 401 })

  // Validate + atomically consume one use. Rejects tampered/expired/exhausted
  // tokens; the conditional UPDATE inside makes this replay/race-safe.
  const v = await validateAndConsume(pool, token)
  if (!v.ok) {
    const status = v.error === 'invalid_token' ? 401 : v.error === 'token_expired' ? 401 : 429
    return NextResponse.json({ error: v.error }, { status })
  }

  const body = (await req.json().catch(() => ({}))) as ResponseBody
  const responseType = body.response_type === 'in_channel' ? 'in_channel' : 'ephemeral'

  // Project blocks → text when no explicit text given, so a blocks-only payload
  // still delivers something legible. We do not render Block Kit here.
  let text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text && Array.isArray(body.blocks) && body.blocks.length > 0) {
    text = '[interactive message]'
  }
  if (!text) {
    await auditResponse(pool, { ...v, responseType, status: 'empty_text' })
    return NextResponse.json({ error: 'empty_response' }, { status: 400 })
  }
  text = text.slice(0, 4000)

  // The bound channel must still exist (it may have been deleted after dispatch).
  const { rows: chRows } = await pool.query<{ id: string }>(
    `SELECT id FROM aaelink.channels WHERE id = $1`,
    [v.channelId],
  )
  if (!chRows[0]) {
    await auditResponse(pool, { ...v, responseType, status: 'channel_gone' })
    return NextResponse.json({ error: 'channel_not_found' }, { status: 404 })
  }

  if (responseType === 'ephemeral') {
    // Ephemeral: visible only to the invoking user; never persisted as a channel
    // message. Push through the SAME redisPubSub realtime layer, to the bound
    // user's topic, so clients render it inline without a durable row.
    try {
      await getPubSub().publish(userTopic(v.userId), {
        type: 'notification',
        user_id: v.userId,
        payload: {
          kind: 'slash_command_response',
          response_type: 'ephemeral',
          channel_id: v.channelId,
          command: `/${v.command}`,
          text,
        },
      })
    } catch { /* realtime emit is best-effort; the use was already consumed */ }
    await auditResponse(pool, { ...v, responseType, status: 'delivered' })
    return NextResponse.json({ ok: true, response_type: 'ephemeral' })
  }

  // in_channel: persist as a real message + realtime emit + webhook/notification
  // fan-out via the canonical shared path (do NOT duplicate message creation).
  const messageId = await deliverScheduledMessage(pool, {
    channelId: v.channelId,
    userId: v.userId,
    body: text,
    rootId: '',
    createdAt: Date.now(),
  })

  await auditResponse(pool, { ...v, responseType, status: 'delivered' })
  return NextResponse.json({ ok: true, response_type: 'in_channel', message_id: messageId })
}

export const POST = tracedRoute('POST', '/api/slash-commands/response', _POST)
