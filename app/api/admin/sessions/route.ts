// keep: enterprise admin surface kept for parity (intentional, not yet wired into UI)
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * GET /api/admin/sessions — list active sessions for the workspace.
 * POST /api/admin/sessions — revoke a session by id.
 *
 * Sessions are stored in `aaelink.user_sessions`.
 */

const SESSIONS_DDL = `
  CREATE TABLE IF NOT EXISTS aaelink.user_sessions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
    device        TEXT NOT NULL DEFAULT 'Unknown',
    os            TEXT NOT NULL DEFAULT 'Unknown',
    browser       TEXT NOT NULL DEFAULT 'Unknown',
    ip_address    INET,
    location      TEXT,
    user_agent    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_active   TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at    TIMESTAMPTZ,
    is_active     BOOLEAN NOT NULL DEFAULT true
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user   ON aaelink.user_sessions(user_id) WHERE is_active;
  CREATE INDEX IF NOT EXISTS idx_sessions_active ON aaelink.user_sessions(is_active, last_active DESC);
`

async function ensureSessions(pool: ReturnType<typeof getPool>) {
  if (!pool) return
  await pool.query(SESSIONS_DDL)
}

async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  const role = (uRows[0] as { platform_role?: string })?.platform_role || ''
  if (!isPlatformAdmin(role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  await ensureSessions(pool)

  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 50, 200)
  const offset = Math.max(Number(req.nextUrl.searchParams.get('offset')) || 0, 0)
  const userId = req.nextUrl.searchParams.get('user_id')?.trim() || ''

  const where: string[] = ['s.is_active = true']
  const params: (string | number)[] = []

  if (userId) {
    params.push(userId)
    where.push(`s.user_id = $${params.length}::uuid`)
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM aaelink.user_sessions s ${whereClause}`, params
  )
  const total = (countRows[0] as { total: number })?.total || 0

  params.push(limit)
  const li = params.length
  params.push(offset)
  const oi = params.length

  const { rows } = await pool.query(
    `SELECT s.*, u.username, u.avatar_url
     FROM aaelink.user_sessions s
     LEFT JOIN aaelink.users u ON u.id = s.user_id
     ${whereClause}
     ORDER BY s.last_active DESC
     LIMIT $${li} OFFSET $${oi}`, params
  )

  return NextResponse.json({ sessions: rows, total, limit, offset })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  const role = (uRows[0] as { platform_role?: string })?.platform_role || ''
  if (!isPlatformAdmin(role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  await ensureSessions(pool)

  const body = await req.json()
  const { action, session_id, user_id } = body as { action: string; session_id?: string; user_id?: string }

  if (action === 'revoke' && session_id) {
    await pool.query(
      `UPDATE aaelink.user_sessions SET is_active = false, revoked_at = now() WHERE id = $1`,
      [session_id]
    )
    // Log the revocation
    await pool.query(
      `INSERT INTO aaelink.audit_log (actor_id, action, target_type, target_id, metadata)
       VALUES ($1, 'session.revoke', 'session', $2, '{}')`,
      [uid, session_id]
    ).catch(() => { /* audit_log table may not exist yet */ })
    return NextResponse.json({ ok: true })
  }

  if (action === 'revoke_all' && user_id) {
    const { rowCount } = await pool.query(
      `UPDATE aaelink.user_sessions SET is_active = false, revoked_at = now()
       WHERE user_id = $1 AND is_active = true AND id != $2`,
      [user_id, session_id || '00000000-0000-0000-0000-000000000000']
    )
    await pool.query(
      `INSERT INTO aaelink.audit_log (actor_id, action, target_type, target_id, metadata)
       VALUES ($1, 'session.revoke_all', 'user', $2, $3)`,
      [uid, user_id, JSON.stringify({ count: rowCount })]
    ).catch(() => {})
    return NextResponse.json({ ok: true, revoked: rowCount })
  }

  return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/sessions', _GET)
export const POST   = tracedRoute('POST', '/api/admin/sessions', _POST)
