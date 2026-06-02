import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { tracedRoute } from '@/lib/api/tracedRoute'

/** GET /api/webhooks/deliveries?webhook_id=... — list delivery attempts for a webhook. */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!isPlatformAdmin(uRows[0]?.platform_role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const webhookId = req.nextUrl.searchParams.get('webhook_id')?.trim()
  if (!webhookId) return NextResponse.json({ error: 'webhook_id_required' }, { status: 400 })

  const { rows } = await pool.query<{
    id: string; event: string; status_code: number; error: string; duration_ms: number; created_at: number
  }>(
    `SELECT id, event, status_code, error, duration_ms, created_at
     FROM aaelink.webhook_deliveries
     WHERE webhook_id = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [webhookId]
  )

  return NextResponse.json({ deliveries: rows })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/webhooks/deliveries', _GET)
