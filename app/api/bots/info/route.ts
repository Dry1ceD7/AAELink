import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Bots Info API — Slack bots.info parity.
 *
 * GET /api/bots/info — get info about a bot user
 *   ?bot_id= — bot user ID
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const botId = req.nextUrl.searchParams.get('bot_id') || req.nextUrl.searchParams.get('bot') || ''

  if (botId) {
    const { rows } = await pool.query<{
      id: string; display_name: string; avatar_url: string; status: string; created_at: number
    }>(
      `SELECT id, display_name, avatar_url, status, created_at
       FROM aaelink.users WHERE id = $1 AND platform_role = 'bot'`, [botId]
    )
    if (!rows[0]) return NextResponse.json({ ok: false, error: 'bot_not_found' }, { status: 404 })

    const bot = rows[0]
    return NextResponse.json({
      ok: true,
      bot: {
        id: bot.id,
        deleted: bot.status === 'deactivated',
        name: bot.display_name,
        icons: { image_36: bot.avatar_url, image_48: bot.avatar_url, image_72: bot.avatar_url },
        updated: bot.created_at,
      },
    })
  }

  // List all bots
  const { rows } = await pool.query<{
    id: string; display_name: string; avatar_url: string; status: string; created_at: number
  }>(
    `SELECT id, display_name, avatar_url, status, created_at
     FROM aaelink.users WHERE platform_role = 'bot'
     ORDER BY display_name ASC`
  )

  const bots = rows.map(r => ({
    id: r.id,
    deleted: r.status === 'deactivated',
    name: r.display_name,
    icons: { image_48: r.avatar_url || '' },
  }))

  return NextResponse.json({ ok: true, bots })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/bots/info', _GET)
