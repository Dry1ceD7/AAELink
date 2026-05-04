import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params

  try {
    const body = await req.json()
    const { status } = body

    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    await pool.query(
      `UPDATE aaelink.leave_requests 
       SET status = $1, approved_by = $2, updated_at = $3
       WHERE id = $4`,
      [status, status === 'approved' || status === 'rejected' ? userId : null, Date.now(), id]
    )

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params

  try {
    // Only allow deletion if pending (or allow HR admins)
    await pool.query(`DELETE FROM aaelink.leave_requests WHERE id = $1 AND user_id = $2 AND status = 'pending'`, [id, userId])
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
