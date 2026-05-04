import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { randomUUID } from 'crypto'

export async function GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const workspace_id = req.nextUrl.searchParams.get('workspace_id')
  if (!workspace_id) return NextResponse.json({ error: 'Missing workspace_id' }, { status: 400 })

  const { rows } = await pool.query(
    `SELECT * FROM aaelink.kb_categories 
     WHERE workspace_id = $1 
     ORDER BY name ASC`,
    [workspace_id]
  )
  return NextResponse.json({ categories: rows })
}

export async function POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { workspace_id, name, description } = await req.json().catch(() => ({}))
  if (!workspace_id || !name) {
    return NextResponse.json({ error: 'Missing workspace_id or name' }, { status: 400 })
  }

  const id = randomUUID()
  const now = Date.now()

  try {
    await pool.query(
      `INSERT INTO aaelink.kb_categories (id, workspace_id, name, description, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, workspace_id, name, description || '', userId, now, now]
    )
    return NextResponse.json({ success: true, id })
  } catch (err) {
    console.error('Error creating KB category:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
