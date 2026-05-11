import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { randomUUID } from 'crypto'
import { tracedRoute } from '@/lib/tracedRoute'

async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const workspace_id = req.nextUrl.searchParams.get('workspace_id')
  const category_id = req.nextUrl.searchParams.get('category_id')
  
  if (!workspace_id) return NextResponse.json({ error: 'Missing workspace_id' }, { status: 400 })

  let query = `
    SELECT a.*, u.username as author_username, u.first_name, u.last_name 
    FROM aaelink.kb_articles a
    LEFT JOIN aaelink.users u ON u.id = a.author_id
    WHERE a.workspace_id = $1
  `
  const params: (string | number)[] = [workspace_id]

  if (category_id) {
    query += ` AND a.category_id = $2`
    params.push(category_id)
  }

  query += ` ORDER BY a.updated_at DESC`

  const { rows } = await pool.query(query, params)
  return NextResponse.json({ articles: rows })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { workspace_id, category_id, title, content, is_published } = await req.json().catch(() => ({}))
  if (!workspace_id || !title || !content) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const id = randomUUID()
  const now = Date.now()

  try {
    await pool.query(
      `INSERT INTO aaelink.kb_articles (id, workspace_id, category_id, title, content, author_id, is_published, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, workspace_id, category_id || null, title, content, userId, is_published ?? true, now, now]
    )
    return NextResponse.json({ success: true, id })
  } catch (err: unknown) {
    console.error('Error creating KB article:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/kb/articles', _GET)
export const POST   = tracedRoute('POST', '/api/kb/articles', _POST)
