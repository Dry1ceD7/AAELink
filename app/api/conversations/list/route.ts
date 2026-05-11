import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Conversations List API — Slack conversations.list parity.
 *
 * GET /api/conversations/list — list all conversations the user can see
 *   ?types=    — public_channel, private_channel, mpim, im (comma separated)
 *   ?limit=    — page size
 *   ?cursor=   — pagination cursor
 *   ?exclude_archived= — exclude archived channels
 *   ?team_id=  — workspace filter
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const types = (req.nextUrl.searchParams.get('types') || 'public_channel,private_channel,mpim,im').split(',').map(t => t.trim())
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') || 100), 1000)
  const cursor = req.nextUrl.searchParams.get('cursor') || ''
  const excludeArchived = req.nextUrl.searchParams.get('exclude_archived') !== 'false'
  const teamId = req.nextUrl.searchParams.get('team_id') || ''

  // Map Slack types to AAELink channel types
  const typeMap: Record<string, string> = {
    public_channel: 'O',
    private_channel: 'P',
    mpim: 'G',
    im: 'D',
  }
  const dbTypes = types.map(t => typeMap[t] || t).filter(Boolean)

  let query = `
    SELECT DISTINCT c.id, c.name, c.type, c.workspace_id, c.created_by, c.created_at,
           COALESCE(c.is_archived, false) AS is_archived,
           COALESCE(c.topic, '') AS topic,
           COALESCE(c.purpose, '') AS purpose,
           COALESCE(c.is_default, false) AS is_default,
           (SELECT COUNT(*)::int FROM aaelink.channel_members WHERE channel_id = c.id) AS num_members,
           EXISTS(SELECT 1 FROM aaelink.channel_members WHERE channel_id = c.id AND user_id = $1) AS is_member
    FROM aaelink.channels c
    LEFT JOIN aaelink.channel_members cm ON cm.channel_id = c.id AND cm.user_id = $1
    WHERE (c.type = 'O' OR cm.user_id IS NOT NULL)
  `
  const params: unknown[] = [uid]

  if (dbTypes.length > 0) {
    params.push(dbTypes)
    query += ` AND c.type = ANY($${params.length})`
  }

  if (excludeArchived) {
    query += ` AND COALESCE(c.is_archived, false) = false`
  }

  if (teamId) {
    params.push(teamId)
    query += ` AND c.workspace_id = $${params.length}`
  }

  if (cursor) {
    params.push(cursor)
    query += ` AND c.id > $${params.length}`
  }

  query += ` ORDER BY c.name ASC LIMIT $${params.length + 1}`
  params.push(limit + 1)

  const { rows } = await pool.query(query, params)
  const hasMore = rows.length > limit
  const channels = rows.slice(0, limit).map(r => {
    return {
      id: r.id,
      name: r.name,
      is_channel: r.type === 'O' || r.type === 'P',
      is_group: r.type === 'G',
      is_im: r.type === 'D',
      is_mpim: r.type === 'G',
      is_private: r.type === 'P',
      is_archived: r.is_archived,
      is_general: r.is_default,
      is_member: r.is_member,
      topic: { value: r.topic || '', last_set: 0 },
      purpose: { value: r.purpose || '', last_set: 0 },
      num_members: r.num_members || 0,
      created: r.created_at,
    }
  })

  return NextResponse.json({
    ok: true,
    channels,
    response_metadata: {
      next_cursor: hasMore ? String(channels[channels.length - 1]?.id || '') : '',
    },
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/conversations/list', _GET)
