import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { writeAuditLog } from '@/lib/enterprise/auditLog'

/** True if the user authored the article or is a platform admin. */
async function canManageArticle(
  pool: import('pg').Pool, userId: string, authorId: string
): Promise<boolean> {
  if (authorId === userId) return true
  const { rows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [userId]
  )
  return isPlatformAdmin(rows[0]?.platform_role || '')
}

async function _GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params

  try {
    const { rows } = await pool.query(
      `SELECT a.*, u.username as author_username, u.first_name, u.last_name, c.name as category_name
       FROM aaelink.kb_articles a
       LEFT JOIN aaelink.users u ON u.id = a.author_id
       LEFT JOIN aaelink.kb_categories c ON c.id = a.category_id
       WHERE a.id = $1`,
      [id]
    )
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Increment view count in the background
    pool.query(`UPDATE aaelink.kb_articles SET view_count = view_count + 1 WHERE id = $1`, [id]).catch(console.error)

    return NextResponse.json({ article: rows[0] })
  } catch (err: unknown) {
    console.error('Error fetching KB article:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

async function _PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params
  const { title, content, category_id, is_published } = await req.json().catch(() => ({}))

  try {
    const { rows } = await pool.query<{ author_id: string }>(`SELECT author_id FROM aaelink.kb_articles WHERE id = $1`, [id])
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Only the author or a platform admin may edit a KB article.
    if (!(await canManageArticle(pool, userId, rows[0].author_id))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const updates = []
    const values = []
    let i = 1

    if (title !== undefined) { updates.push(`title = $${i++}`); values.push(title) }
    if (content !== undefined) { updates.push(`content = $${i++}`); values.push(content) }
    if (category_id !== undefined) { updates.push(`category_id = $${i++}`); values.push(category_id) }
    if (is_published !== undefined) { updates.push(`is_published = $${i++}`); values.push(is_published) }

    if (updates.length === 0) return NextResponse.json({ success: true })

    updates.push(`updated_at = $${i++}`)
    values.push(Date.now())
    values.push(id)

    await pool.query(
      `UPDATE aaelink.kb_articles SET ${updates.join(', ')} WHERE id = $${i}`,
      values
    )
    writeAuditLog({ pool, actorId: userId, action: 'kb.article.update', resourceKind: 'kb_article', resourceId: id })
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    console.error('Error updating KB article:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

async function _DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params

  try {
    const { rows } = await pool.query<{ author_id: string }>(`SELECT author_id FROM aaelink.kb_articles WHERE id = $1`, [id])
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!(await canManageArticle(pool, userId, rows[0].author_id))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    await pool.query(`DELETE FROM aaelink.kb_articles WHERE id = $1`, [id])
    writeAuditLog({ pool, actorId: userId, action: 'kb.article.delete', resourceKind: 'kb_article', resourceId: id })
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    console.error('Error deleting KB article:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/kb/articles/:id', _GET)
export const PATCH  = tracedRoute('PATCH', '/api/kb/articles/:id', _PATCH)
export const DELETE = tracedRoute('DELETE', '/api/kb/articles/:id', _DELETE)
