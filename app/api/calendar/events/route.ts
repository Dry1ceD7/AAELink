import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { randomUUID } from 'crypto'
import { tracedRoute } from '@/lib/api/tracedRoute'

async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const workspaceId = searchParams.get('workspace_id')
  
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id required' }, { status: 400 })
  }

  try {
    const { rows: events } = await pool.query(
      `SELECT e.*, u.username as creator_username, u.first_name, u.last_name
       FROM aaelink.calendar_events e
       LEFT JOIN aaelink.users u ON e.created_by = u.id
       WHERE e.workspace_id = $1
       ORDER BY e.start_time ASC`,
      [workspaceId]
    )
    return NextResponse.json({ events })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'calendar_query_failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { workspace_id, title, description, start_time, end_time, location, is_all_day } = body

    if (!workspace_id || !title || !start_time || !end_time) {
      return NextResponse.json({ error: 'missing required fields' }, { status: 400 })
    }

    const id = randomUUID()
    const now = Date.now()

    await pool.query(
      `INSERT INTO aaelink.calendar_events 
       (id, workspace_id, title, description, start_time, end_time, location, is_all_day, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, workspace_id, title, description || '', start_time, end_time, location || '', is_all_day || false, userId, now]
    )

    return NextResponse.json({ success: true, id })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'calendar_create_failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/calendar/events', _GET)
export const POST   = tracedRoute('POST', '/api/calendar/events', _POST)
