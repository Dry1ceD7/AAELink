// keep: slack-compat surface (intentionally addressable, may be invoked by Slack-shaped clients)
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Channel Topic & Purpose API (Slack parity).
 *
 * GET   /api/channels/topic?channel_id=...
 * PATCH /api/channels/topic { channel_id, topic?, purpose? }
 *
 * Topic:   Short descriptor shown in channel header (max 250 chars).
 * Purpose: Longer description of the channel's intent (max 1000 chars).
 *
 * Updates post a system message so history shows who changed the topic.
 */

/** GET — get topic and purpose */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const channelId = req.nextUrl.searchParams.get('channel_id')?.trim() || ''
  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  const { rows } = await pool.query<{
    topic: string
    purpose: string
    topic_set_by: string
    topic_set_at: string
    purpose_set_by: string
    purpose_set_at: string
  }>(`
    SELECT
      COALESCE(topic, '') AS topic,
      COALESCE(purpose, '') AS purpose,
      COALESCE(topic_set_by, '') AS topic_set_by,
      COALESCE(topic_set_at, 0)::text AS topic_set_at,
      COALESCE(purpose_set_by, '') AS purpose_set_by,
      COALESCE(purpose_set_at, 0)::text AS purpose_set_at
    FROM aaelink.channels WHERE id = $1
  `, [channelId])

  if (!rows[0]) return NextResponse.json({ error: 'channel_not_found' }, { status: 404 })

  // Get setter usernames
  const r = rows[0]
  let topicSetByName = ''
  let purposeSetByName = ''

  if (r.topic_set_by) {
    const { rows: u } = await pool.query<{ username: string }>(
      `SELECT username FROM aaelink.users WHERE id = $1`, [r.topic_set_by]
    )
    topicSetByName = u[0]?.username || ''
  }
  if (r.purpose_set_by) {
    const { rows: u } = await pool.query<{ username: string }>(
      `SELECT username FROM aaelink.users WHERE id = $1`, [r.purpose_set_by]
    )
    purposeSetByName = u[0]?.username || ''
  }

  return NextResponse.json({
    channel_id: channelId,
    topic: r.topic,
    purpose: r.purpose,
    topic_set_by: r.topic_set_by || null,
    topic_set_by_username: topicSetByName || null,
    topic_set_at: Number(r.topic_set_at) || null,
    purpose_set_by: r.purpose_set_by || null,
    purpose_set_by_username: purposeSetByName || null,
    purpose_set_at: Number(r.purpose_set_at) || null
  })
}

/** PATCH — update topic and/or purpose */
async function _PATCH(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    channel_id?: string
    topic?: string
    purpose?: string
  }

  const channelId = String(body.channel_id || '').trim()
  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  // Verify membership
  const { rows: memberRows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`,
    [channelId, uid]
  )
  if (!memberRows[0]) return NextResponse.json({ error: 'not_a_member' }, { status: 403 })

  const now = Date.now()
  const updates: string[] = []
  const params: (string | number)[] = []
  let idx = 1

  // Get username for system messages
  const { rows: uRows } = await pool.query<{ username: string }>(
    `SELECT username FROM aaelink.users WHERE id = $1`, [uid]
  )
  const username = uRows[0]?.username || 'someone'

  if (body.topic !== undefined) {
    const topic = String(body.topic).trim().substring(0, 250)
    updates.push(`topic = $${idx}, topic_set_by = $${idx + 1}, topic_set_at = $${idx + 2}`)
    params.push(topic, uid, now)
    idx += 3

    // System message for topic change
    const { randomUUID } = await import('crypto')
    await pool.query(`
      INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, '', $5, $5)
    `, [randomUUID(), channelId, uid,
        topic ? `**@${username}** set the channel topic: ${topic}` : `**@${username}** cleared the channel topic`,
        now]).catch(() => {})
  }

  if (body.purpose !== undefined) {
    const purpose = String(body.purpose).trim().substring(0, 1000)
    updates.push(`purpose = $${idx}, purpose_set_by = $${idx + 1}, purpose_set_at = $${idx + 2}`)
    params.push(purpose, uid, now)
    idx += 3

    // System message for purpose change
    const { randomUUID } = await import('crypto')
    await pool.query(`
      INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, '', $5, $5)
    `, [randomUUID(), channelId, uid,
        purpose ? `**@${username}** set the channel purpose: ${purpose}` : `**@${username}** cleared the channel purpose`,
        now + 1]).catch(() => {})
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: 'no_changes' }, { status: 400 })
  }

  params.push(channelId)
  await pool.query(
    `UPDATE aaelink.channels SET ${updates.join(', ')} WHERE id = $${idx}`,
    params
  )

  return NextResponse.json({ ok: true, updated_at: now })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/channels/topic', _GET)
export const PATCH  = tracedRoute('PATCH', '/api/channels/topic', _PATCH)
