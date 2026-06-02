// keep: slack-compat surface (intentionally addressable, may be invoked by Slack-shaped clients)
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Files Comments API — Slack files.comments parity.
 *
 * GET  /api/files/comments?file_id=... — list comments on a file
 * POST /api/files/comments — add/edit/delete comment
 *   Actions: add, edit, delete
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const fileId = req.nextUrl.searchParams.get('file_id') || ''
  if (!fileId) return NextResponse.json({ error: 'file_id_required' }, { status: 400 })

  await ensureFileCommentsTable(pool)

  const { rows } = await pool.query(
    `SELECT fc.id, fc.file_id, fc.user_id, fc.comment, fc.created_at, fc.updated_at,
            u.username, u.display_name, u.avatar_url
     FROM aaelink.file_comments fc
     LEFT JOIN aaelink.users u ON u.id = fc.user_id
     WHERE fc.file_id = $1
     ORDER BY fc.created_at ASC`,
    [fileId]
  )

  return NextResponse.json({ comments: rows })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    action?: string
    file_id?: string
    comment_id?: string
    comment?: string
  }

  if (!body.file_id) return NextResponse.json({ error: 'file_id_required' }, { status: 400 })

  await ensureFileCommentsTable(pool)
  const now = Date.now()

  if (body.action === 'add' || !body.action) {
    if (!body.comment?.trim()) return NextResponse.json({ error: 'comment_required' }, { status: 400 })
    const id = randomUUID()
    await pool.query(
      `INSERT INTO aaelink.file_comments (id, file_id, user_id, comment, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [id, body.file_id, uid, body.comment.trim(), now]
    )
    return NextResponse.json({ ok: true, comment_id: id })
  }

  if (body.action === 'edit') {
    if (!body.comment_id) return NextResponse.json({ error: 'comment_id_required' }, { status: 400 })
    if (!body.comment?.trim()) return NextResponse.json({ error: 'comment_required' }, { status: 400 })
    await pool.query(
      `UPDATE aaelink.file_comments SET comment = $1, updated_at = $2 WHERE id = $3 AND user_id = $4`,
      [body.comment.trim(), now, body.comment_id, uid]
    )
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'delete') {
    if (!body.comment_id) return NextResponse.json({ error: 'comment_id_required' }, { status: 400 })
    await pool.query(
      `DELETE FROM aaelink.file_comments WHERE id = $1 AND (user_id = $2 OR EXISTS (
        SELECT 1 FROM aaelink.users WHERE id = $2 AND platform_role IN ('super_admin','platform_admin')
      ))`,
      [body.comment_id, uid]
    )
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
}

async function ensureFileCommentsTable(pool: import('pg').Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.file_comments (
      id         TEXT PRIMARY KEY,
      file_id    TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      comment    TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL DEFAULT 0
    )
  `).catch(() => {})
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_file_comments_file ON aaelink.file_comments(file_id)`).catch(() => {})
}

export const GET  = tracedRoute('GET',  '/api/files/comments', _GET)
export const POST = tracedRoute('POST', '/api/files/comments', _POST)
