import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Custom Emoji API (Slack parity: workspace-level custom emoji).
 *
 * GET    /api/emoji?workspace_id=...  — list all custom emoji for the workspace
 * POST   /api/emoji                   — create a custom emoji
 * DELETE /api/emoji                   — delete a custom emoji (creator or admin only)
 *
 * Emoji are stored as text aliases mapped to either:
 *   - A URL (image_url) for uploaded emoji
 *   - An alias_for reference to an existing emoji (alias feature)
 */

/** GET — list custom emoji for a workspace */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const workspaceId = req.nextUrl.searchParams.get('workspace_id')?.trim() || ''
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })

  const { rows } = await pool.query(
    `SELECT e.id, e.name, e.image_url, e.alias_for, e.created_by,
            u.username AS creator_username,
            e.created_at
     FROM aaelink.custom_emoji e
     LEFT JOIN aaelink.users u ON u.id = e.created_by
     WHERE e.workspace_id = $1
     ORDER BY e.name ASC`,
    [workspaceId]
  )

  return NextResponse.json({ emoji: rows })
}

/** POST — create or upload a custom emoji */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    workspace_id?: string
    name?: string
    image_url?: string
    alias_for?: string
  }

  const workspaceId = String(body.workspace_id || '').trim()
  const name = String(body.name || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
  const imageUrl = String(body.image_url || '').trim()
  const aliasFor = String(body.alias_for || '').trim()

  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  if (!name || name.length < 2 || name.length > 64) {
    return NextResponse.json({ error: 'invalid_emoji_name' }, { status: 400 })
  }
  if (!imageUrl && !aliasFor) {
    return NextResponse.json({ error: 'image_url_or_alias_required' }, { status: 400 })
  }

  // Verify user is workspace member
  const { rows: membership } = await pool.query(
    `SELECT 1 FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, uid]
  )
  if (!membership[0]) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // Check for duplicate name in workspace
  const { rows: existing } = await pool.query(
    `SELECT id FROM aaelink.custom_emoji WHERE workspace_id = $1 AND name = $2`,
    [workspaceId, name]
  )
  if (existing[0]) {
    return NextResponse.json({ error: 'emoji_name_taken' }, { status: 409 })
  }

  const id = randomUUID()
  const now = Date.now()

  await pool.query(
    `INSERT INTO aaelink.custom_emoji (id, workspace_id, name, image_url, alias_for, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, workspaceId, name, imageUrl || '', aliasFor || '', uid, now]
  )

  return NextResponse.json({
    emoji: { id, name, image_url: imageUrl, alias_for: aliasFor, created_by: uid, created_at: now }
  })
}

/** DELETE — remove a custom emoji */
async function _DELETE(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { emoji_id?: string; workspace_id?: string }
  const emojiId = String(body.emoji_id || '').trim()
  const workspaceId = String(body.workspace_id || '').trim()
  if (!emojiId) return NextResponse.json({ error: 'emoji_id_required' }, { status: 400 })

  // Only the creator or workspace admins can delete
  const { rows } = await pool.query<{ created_by: string; workspace_id: string }>(
    `SELECT created_by, workspace_id FROM aaelink.custom_emoji WHERE id = $1`,
    [emojiId]
  )
  if (!rows[0]) return NextResponse.json({ error: 'emoji_not_found' }, { status: 404 })

  const isCreator = rows[0].created_by === uid
  const wsId = workspaceId || rows[0].workspace_id

  if (!isCreator) {
    // Check if user is workspace admin
    const { rows: wmRows } = await pool.query<{ role: string }>(
      `SELECT role FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [wsId, uid]
    )
    if (!['owner', 'admin'].includes(wmRows[0]?.role || '')) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }

  await pool.query(`DELETE FROM aaelink.custom_emoji WHERE id = $1`, [emojiId])

  // Audit
  try {
    await pool.query(
      `INSERT INTO aaelink.audit_log (id, workspace_id, actor_id, action, resource_kind, resource_id, created_at)
       VALUES ($1, $2, $3, 'emoji.delete', 'emoji', $4, $5)`,
      [randomUUID(), wsId, uid, emojiId, Date.now()]
    )
  } catch { /* best-effort */ }

  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET',    '/api/emoji', _GET)
export const POST   = tracedRoute('POST',   '/api/emoji', _POST)
export const DELETE = tracedRoute('DELETE', '/api/emoji', _DELETE)
