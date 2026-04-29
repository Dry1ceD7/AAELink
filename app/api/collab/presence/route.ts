import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'

/** Client heartbeat: marks the signed-in user as recently active (for presence). */
export async function POST() {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const now = Date.now()
  await pool.query(`UPDATE aaelink.users SET last_seen_at = $1 WHERE id = $2`, [now, uid])
  return NextResponse.json({ ok: true, last_seen_at: now })
}
