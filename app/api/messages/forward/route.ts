// keep: slack-compat surface (intentionally addressable, may be invoked by Slack-shaped clients)
import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { applyDlpToMessage } from '@/lib/enterprise/dlpInterceptor'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { verifyCsrf } from '@/lib/auth/csrf'
import { isChannelArchived, userCanPostToChannel } from '@/lib/enterprise/collab-access'

/**
 * Message Forwarding API (Slack "Share message" / "Forward to channel").
 *
 * POST /api/messages/forward  — forward a message to another channel
 *
 * Creates a new message in the target channel with the original
 * message content wrapped in a quote block, preserving attribution.
 */

async function _POST(req: NextRequest) {
  const csrfErr = await verifyCsrf(req)
  if (csrfErr) return csrfErr
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    message_id?: string
    target_channel_id?: string
    comment?: string
  }

  const messageId = String(body.message_id || '').trim()
  const targetChannelId = String(body.target_channel_id || '').trim()
  const comment = String(body.comment || '').trim()

  if (!messageId) return NextResponse.json({ error: 'message_id_required' }, { status: 400 })
  if (!targetChannelId) return NextResponse.json({ error: 'target_channel_id_required' }, { status: 400 })

  // Get the original message
  const { rows: msgRows } = await pool.query<{
    body: string; user_id: string; channel_id: string; created_at: string
  }>(
    `SELECT m.body, m.user_id, m.channel_id, m.created_at
     FROM aaelink.messages m WHERE m.id = $1`,
    [messageId]
  )
  if (!msgRows[0]) return NextResponse.json({ error: 'message_not_found' }, { status: 404 })

  const original = msgRows[0]

  // Get the original author info
  const { rows: authorRows } = await pool.query<{ username: string; first_name: string; last_name: string }>(
    `SELECT username, first_name, last_name FROM aaelink.users WHERE id = $1`,
    [original.user_id]
  )
  const author = authorRows[0]
  const authorName = author
    ? [author.first_name, author.last_name].filter(Boolean).join(' ') || author.username
    : 'Unknown'

  // Verify user has access to target channel
  const { rows: targetCheck } = await pool.query<{ type: string; workspace_id: string }>(
    `SELECT type, workspace_id FROM aaelink.channels WHERE id = $1`,
    [targetChannelId]
  )
  if (!targetCheck[0]) return NextResponse.json({ error: 'target_channel_not_found' }, { status: 404 })

  if (await isChannelArchived(pool, targetChannelId)) {
    return NextResponse.json({ error: 'channel_archived' }, { status: 403 })
  }
  if (!(await userCanPostToChannel(pool, uid, targetChannelId))) {
    return NextResponse.json({ error: 'forbidden_read_only_channel' }, { status: 403 })
  }

  // Get source channel name for attribution
  const { rows: srcChannel } = await pool.query<{ display_name: string }>(
    `SELECT display_name FROM aaelink.channels WHERE id = $1`,
    [original.channel_id]
  )
  const srcChannelName = srcChannel[0]?.display_name || 'unknown channel'

  // Build forwarded message with quote block
  const timestamp = new Date(Number(original.created_at)).toISOString()
  let forwardedBody = `📨 *Forwarded from #${srcChannelName}*\n`
  forwardedBody += `> **${authorName}** — ${timestamp}\n`
  forwardedBody += `> ${original.body.split('\n').join('\n> ')}`

  if (comment) {
    forwardedBody += `\n\n${comment}`
  }

  // DLP check on the forwarded body before persisting.
  const dlp = await applyDlpToMessage({ content: forwardedBody, userId: uid, channelId: targetChannelId })
  if (!dlp.allowed) return NextResponse.json({ error: 'dlp_blocked' }, { status: 403 })
  const safeBody = dlp.content

  // Create the forwarded message
  const newId = randomUUID()
  const now = Date.now()

  await pool.query(
    `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '', $5, $5)`,
    [newId, targetChannelId, uid, safeBody, now]
  )

  // Record in forwarding log for analytics
  await pool.query(
    `INSERT INTO aaelink.message_forwards (id, original_message_id, forwarded_message_id, source_channel_id, target_channel_id, forwarded_by, forwarded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [randomUUID(), messageId, newId, original.channel_id, targetChannelId, uid, now]
  ).catch(() => { /* best-effort tracking */ })

  return NextResponse.json({
    ok: true,
    message_id: newId,
    target_channel_id: targetChannelId
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/messages/forward', _POST)
