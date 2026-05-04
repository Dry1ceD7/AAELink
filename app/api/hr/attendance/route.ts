import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { randomUUID } from 'crypto'

export async function GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const { searchParams } = new URL(req.url)
  const workspaceId = searchParams.get('workspace_id')
  const dateStr = searchParams.get('date_str') // YYYY-MM-DD
  const userId = searchParams.get('user_id')
  
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id required' }, { status: 400 })
  }

  try {
    let query = `
      SELECT l.*, u.username, u.first_name, u.last_name
      FROM aaelink.attendance_logs l
      JOIN aaelink.users u ON l.user_id = u.id
      WHERE l.workspace_id = $1
    `
    const params: any[] = [workspaceId]
    
    if (dateStr) {
      params.push(dateStr)
      query += ` AND l.date_str = $${params.length}`
    }

    if (userId) {
      params.push(userId)
      query += ` AND l.user_id = $${params.length}`
    }
    
    query += ` ORDER BY l.created_at DESC`

    const { rows: logs } = await pool.query(query, params)
    return NextResponse.json({ logs })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { workspace_id, action, note } = body // action: 'in' or 'out'

    if (!workspace_id || !action) {
      return NextResponse.json({ error: 'missing required fields' }, { status: 400 })
    }

    const now = Date.now()
    const d = new Date(now)
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

    if (action === 'in') {
      const id = randomUUID()
      await pool.query(
        `INSERT INTO aaelink.attendance_logs 
         (id, workspace_id, user_id, clock_in_time, date_str, note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, workspace_id, userId, now, dateStr, note || '', now]
      )
      return NextResponse.json({ success: true, id })
    } else if (action === 'out') {
      // Find the most recent active clock-in for today
      const { rows: active } = await pool.query(
        `SELECT id FROM aaelink.attendance_logs 
         WHERE workspace_id = $1 AND user_id = $2 AND date_str = $3 AND clock_out_time IS NULL
         ORDER BY clock_in_time DESC LIMIT 1`,
        [workspace_id, userId, dateStr]
      )

      if (active.length > 0) {
        await pool.query(
          `UPDATE aaelink.attendance_logs SET clock_out_time = $1 WHERE id = $2`,
          [now, active[0].id]
        )
      } else {
        // If they didn't clock in, or are clocking out the next day, just create a new record
        const id = randomUUID()
        await pool.query(
          `INSERT INTO aaelink.attendance_logs 
           (id, workspace_id, user_id, clock_in_time, clock_out_time, date_str, note, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, workspace_id, userId, now, now, dateStr, note || '', now]
        )
      }
      return NextResponse.json({ success: true })
    }
    
    return NextResponse.json({ error: 'invalid action' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
