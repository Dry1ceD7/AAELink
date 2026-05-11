import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Keyword Notifications API (Slack "My keywords" / Mattermost "Words That Trigger Mentions").
 *
 * Users can define custom keywords that trigger notifications when mentioned
 * in any channel they belong to, beyond just @username mentions.
 *
 * GET  /api/keywords                      — get user's notification keywords
 * PUT  /api/keywords { keywords: string[] } — set user's keywords (replace all)
 */

/** GET — get current user's notification keywords */
async function _GET() {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows } = await pool.query<{ keywords: string; updated_at: string }>(
    `SELECT keywords, updated_at FROM aaelink.user_keywords WHERE user_id = $1`,
    [uid]
  )

  if (!rows[0]) {
    return NextResponse.json({ keywords: [], updated_at: 0 })
  }

  let keywords: string[] = []
  try {
    keywords = JSON.parse(rows[0].keywords)
  } catch {
    keywords = []
  }

  return NextResponse.json({ keywords, updated_at: Number(rows[0].updated_at) })
}

/** PUT — set notification keywords (replaces all) */
async function _PUT(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { keywords?: string[] }

  if (!Array.isArray(body.keywords)) {
    return NextResponse.json({ error: 'keywords_must_be_array' }, { status: 400 })
  }

  // Sanitize: lowercase, trim, dedup, max 50 keywords, each max 64 chars
  const keywords = [...new Set(
    body.keywords
      .map(k => String(k).trim().toLowerCase())
      .filter(k => k.length >= 2 && k.length <= 64)
  )].slice(0, 50)

  const now = Date.now()

  await pool.query(
    `INSERT INTO aaelink.user_keywords (user_id, keywords, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET keywords = $2, updated_at = $3`,
    [uid, JSON.stringify(keywords), now]
  )

  return NextResponse.json({ keywords, updated_at: now })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/keywords', _GET)
export const PUT    = tracedRoute('PUT', '/api/keywords', _PUT)
