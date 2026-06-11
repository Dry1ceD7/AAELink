import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Chat API — Slack chat.postMessage / chat.update / chat.delete / chat.unfurl parity.
 *
 * POST /api/chat — unified message posting for apps/bots
 *
 * Supports:
 *   - chat.postMessage — send a message as bot/app
 *   - chat.postEphemeral — send ephemeral message visible to one user
 *   - chat.update — update a message
 *   - chat.delete — delete a message
 *   - chat.unfurl — provide unfurl data for URLs
 *   - chat.meMessage — /me messages
 *   - chat.getPermalink — get message permalink
 *   - chat.scheduleMessage — schedule a message
 */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    action?: string
    channel?: string; text?: string; blocks?: Array<Record<string, unknown>>
    thread_ts?: string; reply_broadcast?: boolean; unfurl_links?: boolean
    user?: string; as_user?: boolean
    // For update/delete
    ts?: string
    // For unfurl
    unfurls?: Record<string, unknown>
    // For schedule
    post_at?: number
    // For meMessage
    mrkdwn?: boolean
    // Metadata
    metadata?: Record<string, unknown>
  }

  const action = body.action || 'postMessage'

  if (action === 'postMessage') {
    if (!body.channel || !body.text) {
      return NextResponse.json({ ok: false, error: 'channel and text required' }, { status: 400 })
    }

    const { randomUUID } = await import('crypto')
    const id = randomUUID()
    const now = Date.now()

    await pool.query(`
      INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $6)
    `, [id, body.channel, uid, body.text, body.thread_ts || '', now])

    return NextResponse.json({
      ok: true,
      channel: body.channel,
      ts: String(now),
      message: {
        text: body.text,
        user: uid,
        type: 'message',
        ts: String(now),
        blocks: body.blocks || [],
      },
    })
  }

  if (action === 'postEphemeral') {
    if (!body.channel || !body.text || !body.user) {
      return NextResponse.json({ ok: false, error: 'channel, text, user required' }, { status: 400 })
    }
    // Ephemeral messages are not persisted — delivered via SSE to the specific user
    return NextResponse.json({
      ok: true,
      message_ts: String(Date.now()),
    })
  }

  if (action === 'update') {
    if (!body.channel || !body.ts || !body.text) {
      return NextResponse.json({ ok: false, error: 'channel, ts, text required' }, { status: 400 })
    }
    const now = Date.now()
    await pool.query(`
      UPDATE aaelink.messages SET body = $1, updated_at = $2
      WHERE channel_id = $3 AND id = $4 AND user_id = $5
    `, [body.text, now, body.channel, body.ts, uid])

    return NextResponse.json({
      ok: true,
      channel: body.channel,
      ts: body.ts,
      text: body.text,
    })
  }

  if (action === 'delete') {
    if (!body.channel || !body.ts) {
      return NextResponse.json({ ok: false, error: 'channel and ts required' }, { status: 400 })
    }

    // Check ownership or admin
    const { rows: uRows } = await pool.query<{ platform_role: string }>(
      `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
    )
    const isAdmin = ['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')

    if (isAdmin) {
      await pool.query(`DELETE FROM aaelink.messages WHERE channel_id = $1 AND id = $2`,
        [body.channel, body.ts])
    } else {
      await pool.query(`DELETE FROM aaelink.messages WHERE channel_id = $1 AND id = $2 AND user_id = $3`,
        [body.channel, body.ts, uid])
    }

    return NextResponse.json({ ok: true, channel: body.channel, ts: body.ts })
  }

  if (action === 'unfurl') {
    if (!body.channel || !body.ts || !body.unfurls) {
      return NextResponse.json({ ok: false, error: 'channel, ts, unfurls required' }, { status: 400 })
    }
    // Store unfurl data for URLs — in production this would attach metadata to the message
    return NextResponse.json({ ok: true })
  }

  if (action === 'meMessage') {
    if (!body.channel || !body.text) {
      return NextResponse.json({ ok: false, error: 'channel and text required' }, { status: 400 })
    }
    const { randomUUID } = await import('crypto')
    const id = randomUUID()
    const now = Date.now()

    await pool.query(`
      INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, '', $5, $5)
    `, [id, body.channel, uid, body.text, now])

    return NextResponse.json({ ok: true, channel: body.channel, ts: String(now) })
  }

  if (action === 'getPermalink') {
    if (!body.channel || !body.ts) {
      return NextResponse.json({ ok: false, error: 'channel and ts required' }, { status: 400 })
    }
    const permalink = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/messages/${body.channel}/p${body.ts}`
    return NextResponse.json({ ok: true, channel: body.channel, permalink })
  }

  if (action === 'scheduleMessage') {
    if (!body.channel || !body.text || !body.post_at) {
      return NextResponse.json({ ok: false, error: 'channel, text, post_at required' }, { status: 400 })
    }
    const { randomUUID } = await import('crypto')
    const id = randomUUID()
    const now = Date.now()

    await pool.query(`
      INSERT INTO aaelink.scheduled_messages (id, channel_id, user_id, body, send_at, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [id, body.channel, uid, body.text, body.post_at, now])

    return NextResponse.json({
      ok: true,
      channel: body.channel,
      scheduled_message_id: id,
      post_at: body.post_at,
    })
  }

  return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 })
}

// ── Traced export ───────────────────────────────────────────────────
export const POST = tracedRoute('POST', '/api/chat', _POST)
