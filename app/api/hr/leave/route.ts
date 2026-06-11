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

  const { searchParams } = new URL(req.url)
  const workspaceId = searchParams.get('workspace_id')
  const userId = searchParams.get('user_id')
  
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id required' }, { status: 400 })
  }

  try {
    let query = `
      SELECT l.*, 
             u.username as req_username, u.first_name as req_first, u.last_name as req_last,
             a.username as app_username, a.first_name as app_first, a.last_name as app_last
      FROM aaelink.leave_requests l
      JOIN aaelink.users u ON l.user_id = u.id
      LEFT JOIN aaelink.users a ON l.approved_by = a.id
      WHERE l.workspace_id = $1
    `
    const params: (string | null)[] = [workspaceId]
    
    if (userId) {
      params.push(userId)
      query += ` AND l.user_id = $2`
    }
    
    query += ` ORDER BY l.created_at DESC`

    const { rows: leaves } = await pool.query(query, params)
    return NextResponse.json({ leaves })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'leave_query_failed'
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
    const { workspace_id, leave_type, start_date, end_date, reason } = body

    if (!workspace_id || !leave_type || !start_date || !end_date) {
      return NextResponse.json({ error: 'missing required fields' }, { status: 400 })
    }

    const id = randomUUID()
    const now = Date.now()

    await pool.query(
      `INSERT INTO aaelink.leave_requests 
       (id, workspace_id, user_id, leave_type, start_date, end_date, reason, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9)`,
      [id, workspace_id, userId, leave_type, start_date, end_date, reason || '', now, now]
    )

    return NextResponse.json({ success: true, id })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'leave_request_failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/hr/leave', _GET)
export const POST   = tracedRoute('POST', '/api/hr/leave', _POST)
