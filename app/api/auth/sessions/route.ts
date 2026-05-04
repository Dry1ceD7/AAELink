import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId, SESSION_COOKIE } from '@/lib/session'

/**
 * Session management — list active sessions and revoke specific ones.
 * GET    /api/auth/sessions          → list all sessions for the current user
 * DELETE /api/auth/sessions?id=...   → revoke a specific session
 */

interface SessionRow {
  id: string
  user_agent: string
  ip_address: string
  created_at: number
  expires_at: number
  is_current: boolean
}

/** GET — list all active sessions for the authenticated user. */
export async function GET() {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const currentSid = (await cookies()).get(SESSION_COOKIE)?.value?.trim() || ''

  const { rows } = await pool.query<{
    id: string; user_agent: string; ip_address: string; created_at: number; expires_at: number
  }>(
    `SELECT id, user_agent, ip_address, created_at, expires_at
     FROM aaelink.sessions
     WHERE user_id = $1 AND expires_at > $2
     ORDER BY created_at DESC`,
    [uid, Date.now()]
  )

  const sessions: SessionRow[] = rows.map(r => ({
    ...r,
    is_current: r.id === currentSid
  }))

  return NextResponse.json({ sessions })
}

/** DELETE — revoke a session by ID. */
export async function DELETE(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sessionId = req.nextUrl.searchParams.get('id')?.trim() || ''
  if (!sessionId) {
    return NextResponse.json({ error: 'session_id_required' }, { status: 400 })
  }

  // Only allow deleting the user's own sessions
  const result = await pool.query(
    `DELETE FROM aaelink.sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, uid]
  )

  if ((result as { rowCount?: number }).rowCount === 0) {
    return NextResponse.json({ error: 'session_not_found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
