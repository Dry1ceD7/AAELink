import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId, SESSION_COOKIE } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Session management — list active sessions and revoke specific ones.
 * GET    /api/auth/sessions               → list all sessions for the current user
 * DELETE /api/auth/sessions?id=...        → revoke a specific session
 * DELETE /api/auth/sessions?all_others=1  → revoke all sessions except the current one
 */

interface SessionRow {
  id: string
  user_agent: string
  ip_address: string
  created_at: number
  expires_at: number
  last_active_at: number
  is_current: boolean
  device_type: string
  device_label: string
}

/**
 * Parse a user-agent string into a device type and friendly label.
 */
function parseDevice(ua: string): { device_type: string; device_label: string } {
  if (!ua) return { device_type: 'unknown', device_label: 'Unknown device' }

  // Desktop app
  if (ua.includes('AAELink') || ua.includes('Electron')) {
    if (ua.includes('Macintosh') || ua.includes('Mac OS')) {
      return { device_type: 'desktop', device_label: 'AAELink Desktop — macOS' }
    }
    if (ua.includes('Windows')) {
      return { device_type: 'desktop', device_label: 'AAELink Desktop — Windows' }
    }
    return { device_type: 'desktop', device_label: 'AAELink Desktop' }
  }

  // Mobile
  if (/iPhone|iPad|iPod/i.test(ua)) {
    const match = ua.match(/iPhone OS (\d+[_\d]*)/)
    const ver = match ? ` iOS ${match[1].replace(/_/g, '.')}` : ''
    return { device_type: 'mobile', device_label: `Safari — iPhone${ver}` }
  }
  if (/Android/i.test(ua)) {
    const match = ua.match(/Android ([\d.]+)/)
    const ver = match ? ` ${match[1]}` : ''
    return { device_type: 'mobile', device_label: `Chrome — Android${ver}` }
  }

  // Browser detection
  let browser = 'Browser'
  if (ua.includes('Edg/')) browser = 'Edge'
  else if (ua.includes('OPR/') || ua.includes('Opera')) browser = 'Opera'
  else if (ua.includes('Chrome') && !ua.includes('Edg/')) browser = 'Chrome'
  else if (ua.includes('Firefox')) browser = 'Firefox'
  else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari'

  // OS detection
  let os = ''
  if (ua.includes('Mac OS') || ua.includes('Macintosh')) os = 'macOS'
  else if (ua.includes('Windows')) os = 'Windows'
  else if (ua.includes('Linux')) os = 'Linux'

  const label = os ? `${browser} — ${os}` : browser
  return { device_type: 'browser', device_label: label }
}

/** GET — list all active sessions for the authenticated user. */
async function _GET() {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const currentSid = (await cookies()).get(SESSION_COOKIE)?.value?.trim() || ''

  // Touch the current session's last_active_at
  if (currentSid) {
    await pool.query(
      `UPDATE aaelink.sessions SET last_active_at = $1 WHERE id = $2`,
      [Date.now(), currentSid]
    )
  }

  const { rows } = await pool.query<{
    id: string; user_agent: string; ip_address: string; created_at: number; expires_at: number; last_active_at: number
  }>(
    `SELECT id, user_agent, ip_address, created_at, expires_at, last_active_at
     FROM aaelink.sessions
     WHERE user_id = $1 AND expires_at > $2
     ORDER BY last_active_at DESC, created_at DESC`,
    [uid, Date.now()]
  )

  const sessions: SessionRow[] = rows.map(r => {
    const { device_type, device_label } = parseDevice(r.user_agent || '')
    return {
      ...r,
      is_current: r.id === currentSid,
      device_type,
      device_label
    }
  })

  return NextResponse.json({ sessions, count: sessions.length })
}

/** DELETE — revoke a session by ID, or all others. */
async function _DELETE(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const allOthers = req.nextUrl.searchParams.get('all_others')?.trim()
  const sessionId = req.nextUrl.searchParams.get('id')?.trim() || ''

  // Revoke all other sessions
  if (allOthers === '1' || allOthers === 'true') {
    const currentSid = (await cookies()).get(SESSION_COOKIE)?.value?.trim() || ''
    if (!currentSid) {
      return NextResponse.json({ error: 'no_current_session' }, { status: 400 })
    }
    const result = await pool.query(
      `DELETE FROM aaelink.sessions WHERE user_id = $1 AND id != $2`,
      [uid, currentSid]
    )
    const revoked = (result as { rowCount?: number }).rowCount || 0
    return NextResponse.json({ ok: true, revoked })
  }

  // Revoke a single session
  if (!sessionId) {
    return NextResponse.json({ error: 'session_id_required' }, { status: 400 })
  }

  // Prevent revoking the current session via this endpoint
  const currentSid = (await cookies()).get(SESSION_COOKIE)?.value?.trim() || ''
  if (sessionId === currentSid) {
    return NextResponse.json({ error: 'cannot_revoke_current_session', hint: 'Use /api/auth/logout instead' }, { status: 400 })
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

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/auth/sessions', _GET)
export const DELETE = tracedRoute('DELETE', '/api/auth/sessions', _DELETE)
