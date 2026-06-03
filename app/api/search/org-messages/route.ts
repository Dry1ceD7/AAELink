import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { searchOrgMessages } from '@/lib/messaging/orgSearch'

/**
 * GET /api/search/org-messages?q=...&limit=...&offset=... (D4)
 *
 * Cross-workspace lexical search across every workspace in the caller's org(s).
 * Scoped to reachable channels (member, public-in-org, org-wide, DM).
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q')?.trim() || ''
  const limit = Number(req.nextUrl.searchParams.get('limit')) || 25
  const offset = Number(req.nextUrl.searchParams.get('offset')) || 0

  const result = await searchOrgMessages(pool, uid, q, { limit, offset })
  return NextResponse.json(result)
}

// ── Traced export ───────────────────────────────────────────────────
export const GET = tracedRoute('GET', '/api/search/org-messages', _GET)
