import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { isPlatformAdmin } from '@/lib/platformRole'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params

  try {
    const body = await req.json()

    const { title, description, start_time, end_time, location, is_all_day } = body

    await pool.query(
      `UPDATE aaelink.calendar_events
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           start_time = COALESCE($3, start_time),
           end_time = COALESCE($4, end_time),
           location = COALESCE($5, location),
           is_all_day = COALESCE($6, is_all_day)
       WHERE id = $7`,
      [title, description, start_time, end_time, location, is_all_day, id]
    )

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params

  try {
    const { rows } = await pool.query<{ created_by: string; workspace_id: string }>(
      `SELECT created_by, workspace_id FROM aaelink.calendar_events WHERE id = $1`,
      [id]
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    const ev = rows[0]
    let allowed = ev.created_by === userId

    if (!allowed) {
      // Platform admins can delete any event in any workspace.
      const { rows: uRows } = await pool.query<{ platform_role: string }>(
        `SELECT platform_role FROM aaelink.users WHERE id = $1`,
        [userId]
      )
      if (isPlatformAdmin(uRows[0]?.platform_role || '')) {
        allowed = true
      }
    }

    if (!allowed) {
      // Workspace owner/admin can also delete.
      const { rows: mRows } = await pool.query<{ role: string }>(
        `SELECT role FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
        [ev.workspace_id, userId]
      )
      const wsRole = mRows[0]?.role || ''
      if (wsRole === 'owner' || wsRole === 'admin') {
        allowed = true
      }
    }

    if (!allowed) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    await pool.query(`DELETE FROM aaelink.calendar_events WHERE id = $1`, [id])
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
