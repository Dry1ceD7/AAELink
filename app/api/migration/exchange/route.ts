import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { exchangeUserIds } from '@/lib/enterprise/userIdMigration'

/**
 * POST /api/migration/exchange — exchange legacy user IDs for org-level IDs.
 *
 * Body: { users: string[], team_id: string }
 */

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    users?: string[]; team_id?: string
  }

  if (!Array.isArray(body.users) || !body.team_id) {
    return NextResponse.json({ error: 'users_and_team_id_required' }, { status: 400 })
  }

  const mappings = await exchangeUserIds(pool, body.users, body.team_id)

  return NextResponse.json({
    ok: true,
    enterprise_id_mappings: mappings,
    unmapped: body.users.filter(u => !(u in mappings)),
  })
}

export const POST = tracedRoute('POST', '/api/migration/exchange', _POST)
