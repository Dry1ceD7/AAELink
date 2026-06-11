import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { randomUUID } from 'crypto'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { getPubSub, channelTopic } from '@/lib/realtime/redisPubSub'
import { verifyInbound } from '@/lib/webhooks/inboundVerify'
import { parseInboundPayload } from '@/lib/webhooks/inboundPayload'
import { log } from '@/lib/infra/log'

/**
 * Public receiver for Incoming Webhooks.
 *
 * External systems (HR, Finance, Jira, etc.) POST a Slack/Mattermost-compatible
 * payload — { text, attachments, blocks, username, icon_url } — to
 * /api/webhooks/{secret_token}. No session auth: the secret_token in the URL is
 * the bearer credential. Behaviour:
 *
 *   - Inbound signature: when the webhook row has a non-empty signing_secret we
 *     verify an X-AAELink-Signature / X-AAELink-Timestamp header pair (the same
 *     v0 HMAC-SHA256 scheme AAELink uses to sign OUTBOUND webhooks — see
 *     lib/webhooks/webhookSigning.ts). A missing/forged signature → 401.
 *   - Back-compat: a webhook with NO signing_secret stays OPEN (no signature
 *     required). Existing webhooks provisioned before migration 055 keep working
 *     unauthenticated; only webhooks that set a secret are enforced.
 *   - Rich content: attachments and Block Kit blocks are accepted alongside
 *     text. Blocks are structurally validated (lib/blockkit/validate.ts);
 *     malformed blocks → 400. Bot identity (username/icon) is stored in the
 *     message metadata.
 *   - Realtime fan-out goes through redisPubSub (canonical emit), never a raw
 *     notifications INSERT.
 */
async function _POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const { token } = await params

  try {
    // 1. Resolve the webhook by its secret token.
    const { rows: webhooks } = await pool.query<{
      id: string
      workspace_id: string
      channel_id: string
      created_by: string
      name: string
      signing_secret: string | null
      app_name: string | null
      app_icon: string | null
    }>(
      `SELECT w.id, w.workspace_id, w.channel_id, w.created_by, w.name, w.signing_secret,
              a.name AS app_name, a.icon_url AS app_icon
         FROM aaelink.incoming_webhooks w
         LEFT JOIN aaelink.apps a ON w.app_id = a.id
        WHERE w.secret_token = $1 LIMIT 1`,
      [token]
    )

    if (webhooks.length === 0) {
      return NextResponse.json({ error: 'invalid_webhook_token' }, { status: 401 })
    }
    const webhook = webhooks[0]

    // 2. Read the RAW body once (needed for HMAC verification AND JSON parse).
    const rawBody = await req.text()

    // 3. Inbound signature verification (open back-compat when no secret set).
    const verdict = verifyInbound(webhook.signing_secret, rawBody, req.headers)
    if (verdict.required && !verdict.valid) {
      return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
    }

    // 4. Parse + validate the Slack-compatible payload.
    let parsed: unknown
    try {
      parsed = rawBody ? JSON.parse(rawBody) : null
    } catch {
      return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })
    }
    const result = parseInboundPayload(parsed, {
      id: webhook.id,
      defaultName: webhook.app_name || webhook.name,
      defaultIcon: webhook.app_icon || '',
    })
    if (!result.ok) {
      return NextResponse.json(
        result.details ? { error: result.error, details: result.details } : { error: result.error },
        { status: result.status }
      )
    }

    // 5. Persist the message. Attributed to the webhook creator's user_id; the
    //    bot identity + rich content live in metadata (is_bot marks it).
    const messageId = randomUUID()
    const now = Date.now()
    await pool.query(
      `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at, metadata)
       VALUES ($1, $2, $3, $4, '', $5, $5, $6)`,
      [messageId, webhook.channel_id, webhook.created_by, result.body, now, JSON.stringify(result.metadata)]
    )

    // 6. Realtime fan-out via the canonical redisPubSub emit (mirrors
    //    app/api/messages/route.ts#emitMessageEvent). Carries the rich payload so
    //    connected clients render the new message live.
    try {
      await getPubSub().publish(channelTopic(webhook.channel_id), {
        type: 'message',
        channel_id: webhook.channel_id,
        payload: {
          id: messageId,
          channel_id: webhook.channel_id,
          user_id: webhook.created_by,
          message: result.body,
          create_at: now,
          root_id: '',
          metadata: result.metadata,
        },
      })
    } catch (err) {
      log.warn('webhooks.receive.emit_failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // 7. Audit the write (best-effort — never break the receive path).
    try {
      await pool.query(
        `INSERT INTO aaelink.audit_log (id, workspace_id, actor_id, action, resource_kind, resource_id, metadata, created_at)
         VALUES ($1, $2, $3, 'incoming_webhook.receive', 'message', $4, $5, $6)`,
        [
          randomUUID(),
          webhook.workspace_id,
          webhook.created_by,
          messageId,
          JSON.stringify({ webhook_id: webhook.id, channel_id: webhook.channel_id, signed: verdict.required }),
          now,
        ]
      )
    } catch { /* audit failures must never break the request path */ }

    return NextResponse.json({ success: true, message_id: messageId })
  } catch (e: unknown) {
    log.warn('webhooks.receive.failed', { error: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: 'webhook_receive_failed' }, { status: 500 })
  }
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST = tracedRoute('POST', '/api/webhooks/:token', _POST)
