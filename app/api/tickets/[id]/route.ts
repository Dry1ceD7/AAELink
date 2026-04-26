import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readMattermostToken } from '@/lib/session'

type Status = 'open' | 'in_progress' | 'resolved'
type Priority = 'low' | 'medium' | 'urgent'

function isStatus(v: string): v is Status {
  return v === 'open' || v === 'in_progress' || v === 'resolved'
}

function isPriority(v: string): v is Priority {
  return v === 'low' || v === 'medium' || v === 'urgent'
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readMattermostToken()
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const { id } = await ctx.params
  const body = (await req.json()) as {
    status?: string
    priority?: string
    title?: string
    description?: string
  }
  const now = Date.now()
  const patch: Record<string, unknown> = {}
  if (body.status !== undefined) {
    if (!isStatus(body.status)) return NextResponse.json({ error: 'invalid_status' }, { status: 400 })
    patch.status = body.status
  }
  if (body.priority !== undefined) {
    if (!isPriority(body.priority)) return NextResponse.json({ error: 'invalid_priority' }, { status: 400 })
    patch.priority = body.priority
  }
  if (body.title !== undefined) {
    const t = String(body.title).trim()
    if (!t) return NextResponse.json({ error: 'title_required' }, { status: 400 })
    patch.title = t
  }
  if (body.description !== undefined) {
    patch.description = String(body.description)
  }
  const keys = Object.keys(patch)
  if (keys.length === 0) return NextResponse.json({ error: 'no_updates' }, { status: 400 })
  const setParts = keys.map((k, idx) => `${k} = $${idx + 1}`)
  const values = [...keys.map(k => patch[k]), now, id]
  const res = await pool.query(
    `UPDATE aaelink.tickets SET ${setParts.join(', ')}, updated_at = $${keys.length + 1}
     WHERE id = $${keys.length + 2}
     RETURNING id, title, description, status, priority, created_at AS "createdAt", updated_at AS "updatedAt"`,
    values
  )
  if (res.rowCount === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const t = res.rows[0] as Record<string, unknown>
  return NextResponse.json({
    ticket: {
      ...t,
      createdAt: Number(t.createdAt),
      updatedAt: Number(t.updatedAt)
    }
  })
}
