import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { randomUUID } from 'crypto'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { isWorkspaceMember } from '@/lib/workspace/workspaceAccess'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'

/** True if the user created the category or is a platform admin. */
async function canManageCategory(
  pool: import('pg').Pool, userId: string, creatorId: string
): Promise<boolean> {
  if (creatorId === userId) return true
  const { rows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [userId]
  )
  return isPlatformAdmin(rows[0]?.platform_role || '')
}

async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const workspace_id = req.nextUrl.searchParams.get('workspace_id')
  if (!workspace_id) return NextResponse.json({ error: 'Missing workspace_id' }, { status: 400 })

  // Workspace membership is asserted before any per-workspace data access
  // (Hard Rule #1) — a user from workspace A must not list workspace B's KB.
  if (!(await isWorkspaceMember(pool, userId, workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { rows } = await pool.query(
    `SELECT * FROM aaelink.kb_categories
     WHERE workspace_id = $1
     ORDER BY name ASC`,
    [workspace_id]
  )
  return NextResponse.json({ categories: rows })
}

async function _POST(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { workspace_id, name, description } = await req.json().catch(() => ({}))
  if (!workspace_id || !name) {
    return NextResponse.json({ error: 'Missing workspace_id or name' }, { status: 400 })
  }
  // Only a member of the target workspace may create a category in it.
  if (!(await isWorkspaceMember(pool, userId, workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const id = randomUUID()
  const now = Date.now()

  try {
    await pool.query(
      `INSERT INTO aaelink.kb_categories (id, workspace_id, name, description, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, workspace_id, name, description || '', userId, now, now]
    )
    writeAuditLog({
      pool, actorId: userId, workspaceId: workspace_id, action: 'kb.category.create',
      resourceKind: 'kb_category', resourceId: id, ipAddress: extractIp(req),
    })
    return NextResponse.json({ success: true, id })
  } catch (err: unknown) {
    console.error('Error creating KB category:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

async function _DELETE(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { id?: string }
  const id = String(body.id || req.nextUrl.searchParams.get('id') || '').trim()
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  const { rows } = await pool.query<{ created_by: string; workspace_id: string }>(
    `SELECT created_by, workspace_id FROM aaelink.kb_categories WHERE id = $1`, [id]
  )
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  // Assert membership of the category's workspace before the creator/admin gate —
  // an outsider must not be able to delete (or even probe) another workspace's KB.
  if (!(await isWorkspaceMember(pool, userId, rows[0].workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (!(await canManageCategory(pool, userId, rows[0].created_by))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Refuse to delete a category that still has articles. Articles are
  // compliance-scoped content; silently reassigning or orphaning them on a
  // category delete would lose curation context. The caller must move/delete
  // the articles first (or the FK's ON DELETE SET NULL would null their
  // category_id — we choose the explicit, auditable path instead).
  const { rows: refs } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM aaelink.kb_articles WHERE category_id = $1`, [id]
  )
  if (Number(refs[0]?.n || 0) > 0) {
    return NextResponse.json({ error: 'category_in_use' }, { status: 409 })
  }

  await pool.query(`DELETE FROM aaelink.kb_categories WHERE id = $1`, [id])
  writeAuditLog({
    pool, actorId: userId, workspaceId: rows[0].workspace_id, action: 'kb.category.delete',
    resourceKind: 'kb_category', resourceId: id, ipAddress: extractIp(req),
  })
  return NextResponse.json({ success: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/kb/categories', _GET)
export const POST   = tracedRoute('POST', '/api/kb/categories', _POST)
export const DELETE = tracedRoute('DELETE', '/api/kb/categories', _DELETE)
