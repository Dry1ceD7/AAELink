import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Admin custom emoji management.
 *
 * GET    — list all custom emoji (cross-workspace)
 * POST   — add a custom emoji
 * PATCH  — rename an emoji
 * DELETE — remove an emoji
 */

async function requireAdmin() {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows } = await pool.query(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!isPlatformAdmin((rows[0] as { platform_role?: string })?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  return { uid, pool }
}

async function _GET(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const workspaceId = req.nextUrl.searchParams.get('workspace_id') || ''
  let sql = `SELECT e.*, u.username AS creator_username
             FROM aaelink.custom_emoji e
             LEFT JOIN aaelink.users u ON u.id = e.created_by`
  const params: unknown[] = []

  if (workspaceId) {
    sql += ` WHERE e.workspace_id = $1`
    params.push(workspaceId)
  }
  sql += ` ORDER BY e.name ASC`

  const { rows } = await auth.pool.query(sql, params)
  return NextResponse.json({ emoji: rows })
}

async function _POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const body = await req.json().catch(() => ({})) as {
    workspace_id?: string; name?: string; image_url?: string; alias_for?: string
  }
  if (!body.workspace_id || !body.name) {
    return NextResponse.json({ error: 'workspace_id_and_name_required' }, { status: 400 })
  }
  if (!body.image_url && !body.alias_for) {
    return NextResponse.json({ error: 'image_url_or_alias_required' }, { status: 400 })
  }

  const name = body.name.toLowerCase().replace(/[^a-z0-9_-]/g, '')
  const id = randomUUID()
  const now = Date.now()

  await auth.pool.query(
    `INSERT INTO aaelink.custom_emoji (id, workspace_id, name, image_url, alias_for, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, body.workspace_id, name, body.image_url || '', body.alias_for || '', auth.uid, now]
  )
  return NextResponse.json({ emoji: { id, name, workspace_id: body.workspace_id } }, { status: 201 })
}

async function _PATCH(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const body = await req.json().catch(() => ({})) as { emoji_id?: string; new_name?: string }
  if (!body.emoji_id || !body.new_name) {
    return NextResponse.json({ error: 'emoji_id_and_new_name_required' }, { status: 400 })
  }

  const newName = body.new_name.toLowerCase().replace(/[^a-z0-9_-]/g, '')
  const res = await auth.pool.query(
    `UPDATE aaelink.custom_emoji SET name = $1 WHERE id = $2`,
    [newName, body.emoji_id]
  )
  if ((res.rowCount ?? 0) === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true, name: newName })
}

async function _DELETE(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const body = await req.json().catch(() => ({})) as { emoji_id?: string }
  if (!body.emoji_id) return NextResponse.json({ error: 'emoji_id_required' }, { status: 400 })

  const res = await auth.pool.query(
    `DELETE FROM aaelink.custom_emoji WHERE id = $1`, [body.emoji_id]
  )
  if ((res.rowCount ?? 0) === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Audit
  try {
    await auth.pool.query(
      `INSERT INTO aaelink.audit_log (id, actor_id, action, resource_kind, resource_id, created_at)
       VALUES ($1, $2, 'emoji.admin_delete', 'emoji', $3, $4)`,
      [randomUUID(), auth.uid, body.emoji_id, Date.now()]
    )
  } catch { /* best-effort */ }

  return NextResponse.json({ deleted: true })
}

export const GET    = tracedRoute('GET',    '/api/admin/emoji', _GET)
export const POST   = tracedRoute('POST',   '/api/admin/emoji', _POST)
export const PATCH  = tracedRoute('PATCH',  '/api/admin/emoji', _PATCH)
export const DELETE = tracedRoute('DELETE', '/api/admin/emoji', _DELETE)
