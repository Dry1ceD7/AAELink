import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { getAdminSession } from '@/lib/adminAuth'
import { tracedRoute } from '@/lib/tracedRoute'

async function _GET() {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const adm = await getAdminSession(pool)
  if (!adm) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { rows } = await pool.query<{ is_online: boolean; updated_at: string | number }>(
    `SELECT is_online, updated_at FROM aaelink.support_it_presence WHERE id = 'singleton'`
  )
  const r = rows[0]
  return NextResponse.json({
    is_online: Boolean(r?.is_online),
    updated_at: r?.updated_at != null ? Number(r.updated_at) : 0
  })
}

async function _PATCH(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const adm = await getAdminSession(pool)
  if (!adm) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  let body: { is_online?: boolean }
  try {
    body = (await req.json()) as { is_online?: boolean }
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (typeof body.is_online !== 'boolean') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const now = Date.now()
  await pool.query(
    `UPDATE aaelink.support_it_presence SET is_online = $1, updated_at = $2, updated_by = $3 WHERE id = 'singleton'`,
    [body.is_online, now, adm.userId]
  )
  return NextResponse.json({ ok: true, is_online: body.is_online, updated_at: now })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/support-presence', _GET)
export const PATCH  = tracedRoute('PATCH', '/api/admin/support-presence', _PATCH)
