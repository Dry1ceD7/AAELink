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

export async function GET() {
  const token = await readMattermostToken()
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const { rows } = await pool.query(
    `SELECT id, title, description, status, priority, created_at AS "createdAt", updated_at AS "updatedAt"
     FROM aaelink.tickets ORDER BY created_at DESC`
  )
  const tickets = rows.map(r => {
    const row = r as Record<string, unknown>
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt)
    }
  })
  return NextResponse.json({ tickets })
}

export async function POST(req: Request) {
  const token = await readMattermostToken()
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const body = (await req.json()) as {
    title?: string
    description?: string
    priority?: string
  }
  const title = String(body.title || '').trim()
  if (!title) return NextResponse.json({ error: 'title_required' }, { status: 400 })
  const description = String(body.description || '').trim()
  const priority = body.priority && isPriority(body.priority) ? body.priority : 'medium'
  const now = Date.now()
  const id = `T-${now}-${Math.random().toString(36).slice(2, 8)}`
  await pool.query(
    `INSERT INTO aaelink.tickets (id, title, description, status, priority, created_at, updated_at)
     VALUES ($1, $2, $3, 'open', $4, $5, $5)`,
    [id, title, description, priority, now]
  )
  return NextResponse.json({
    ticket: { id, title, description, status: 'open' as const, priority, createdAt: now, updatedAt: now }
  })
}
