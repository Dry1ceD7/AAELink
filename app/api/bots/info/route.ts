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
 *
 * Bot identity resolves from aaelink.bot_users — the canonical bot model
 * (Integrations #15) managed by app/api/integrations/bots/route.ts and used by
 * lib/api/oauthScopes.ts resolveBotToken to authenticate xbot-* tokens. Bots
 * created through that path were previously invisible to bots.info, which read
 * users WHERE platform_role='bot'; this bridges the two notions (matrix #16).
 *
 * The Slack-compatible response shape is preserved exactly:
 *   single: { ok, bot: { id, deleted, name, app_id, icons, updated } }
 *   list:   { ok, bots: [{ id, deleted, name, app_id, icons }] }
 */
interface BotRow {
  id: string
  name: string
  avatar_url: string
  status: string
  client_id: string | null
  created_at: number | string
}

/** Map a canonical bot_users row onto the Slack bots.info bot object. */
function toBot(r: BotRow) {
  const icon = r.avatar_url || ''
  return {
    id: r.id,
    deleted: r.status !== 'active',
    name: r.name,
    app_id: r.client_id || '', // app linkage: bot's OAuth client identifier
    icons: { image_36: icon, image_48: icon, image_72: icon },
    updated: Number(r.created_at) || 0,
  }
}

async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const botId = req.nextUrl.searchParams.get('bot_id') || req.nextUrl.searchParams.get('bot') || ''

  if (botId) {
    const { rows } = await pool.query<BotRow>(
      `SELECT id, name, avatar_url, status, client_id, created_at
         FROM aaelink.bot_users WHERE id = $1 AND kind = 'bot'`, [botId]
    )
    if (!rows[0]) return NextResponse.json({ ok: false, error: 'bot_not_found' }, { status: 404 })
    return NextResponse.json({ ok: true, bot: toBot(rows[0]) })
  }

  // List all bots
  const { rows } = await pool.query<BotRow>(
    `SELECT id, name, avatar_url, status, client_id, created_at
       FROM aaelink.bot_users WHERE kind = 'bot'
       ORDER BY name ASC
       LIMIT 100`
  )

  const bots = rows.map(r => {
    const b = toBot(r)
    return { id: b.id, deleted: b.deleted, name: b.name, app_id: b.app_id, icons: { image_48: r.avatar_url || '' } }
  })

  return NextResponse.json({ ok: true, bots })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/bots/info', _GET)
