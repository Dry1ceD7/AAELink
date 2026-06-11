import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { removeFileObject } from '@/lib/files/storage'
import { enforceScope, SCOPES } from '@/lib/api/oauthScopes'

/**
 * File Management API — Slack files.list / files.info / files.delete parity.
 *
 * GET    /api/files — list files (paginated, filterable)
 * GET    /api/files?file_id=... — single file info
 * DELETE /api/files — soft-delete a file
 *
 * Filters: channel, user, type, date range, search.
 * Slack parity: files.list, files.info, files.delete, files.sharedPublicURL
 *
 * Canonical table: aaelink.file_attachments (migration 033). The legacy
 * `aaelink.files` table this route used never existed in the migration runner,
 * so list/info/delete returned nothing for real uploads. Soft-deleted rows
 * (deleted_at <> 0) are excluded here while download + public-link history
 * remains for audit.
 */

/** Display name for a user row (the users table has no display_name column). */
const UPLOADER_NAME_SQL = `NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '')`

async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  // Bearer token path (files:read). Falls through to session auth when no token present.
  const scopeResult = await enforceScope(pool, req, SCOPES.FILES_READ)
  if (scopeResult.kind === 'error') return scopeResult.response
  const uid = scopeResult.kind === 'ok'
    ? scopeResult.grant.user_id
    : await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const fileId = req.nextUrl.searchParams.get('file_id') || ''

  // Single file info
  if (fileId) {
    const { rows } = await pool.query<{
      id: string; filename: string; content_type: string; size: number
      storage_key: string; user_id: string; channel_id: string | null
      message_id: string | null; workspace_id: string | null
      width: number | null; height: number | null; duration_ms: number | null
      thumbnail_key: string; created_at: number; uploaded_by_name: string | null
    }>(
      `SELECT f.id, f.filename, f.content_type, f.size, f.storage_key,
              f.user_id, f.channel_id, f.message_id, f.workspace_id,
              f.width, f.height, f.duration_ms, f.thumbnail_key, f.created_at,
              ${UPLOADER_NAME_SQL} AS uploaded_by_name
       FROM aaelink.file_attachments f
       LEFT JOIN aaelink.users u ON u.id = f.user_id
       WHERE f.id = $1 AND f.deleted_at = 0`, [fileId]
    )
    if (!rows[0]) return NextResponse.json({ error: 'file_not_found' }, { status: 404 })
    return NextResponse.json({ file: serializeFile(rows[0]) })
  }

  // List files
  const channelId = req.nextUrl.searchParams.get('channel_id') || ''
  const userId = req.nextUrl.searchParams.get('user_id') || ''
  const fileType = req.nextUrl.searchParams.get('types') || '' // images, videos, docs, etc
  const search = req.nextUrl.searchParams.get('search') || ''
  const tsFrom = req.nextUrl.searchParams.get('ts_from') || ''
  const tsTo = req.nextUrl.searchParams.get('ts_to') || ''
  const limit = Math.min(Number(req.nextUrl.searchParams.get('count') || 50), 200)
  const page = Math.max(Number(req.nextUrl.searchParams.get('page') || 1), 1)
  const offset = (page - 1) * limit

  let query = `
    SELECT f.id, f.filename, f.content_type, f.size, f.storage_key,
           f.user_id, f.channel_id, f.message_id, f.workspace_id,
           f.width, f.height, f.duration_ms, f.thumbnail_key, f.created_at,
           ${UPLOADER_NAME_SQL} AS uploaded_by_name
    FROM aaelink.file_attachments f
    LEFT JOIN aaelink.users u ON u.id = f.user_id
    WHERE f.deleted_at = 0
  `
  const params: unknown[] = []

  if (channelId) {
    params.push(channelId)
    query += ` AND f.channel_id = $${params.length}`
  }

  if (userId) {
    params.push(userId)
    query += ` AND f.user_id = $${params.length}`
  }

  if (fileType) {
    const types = fileType.split(',').map(t => t.trim())
    const mimePatterns = types.map(t => {
      switch (t) {
        case 'images': return 'image/%'
        case 'videos': return 'video/%'
        case 'pdfs': return 'application/pdf'
        case 'docs': return 'application/%'
        case 'audio': return 'audio/%'
        default: return `%${t}%`
      }
    })
    const mimeConditions = mimePatterns.map((_, i) => {
      params.push(mimePatterns[i])
      return `f.content_type LIKE $${params.length}`
    })
    query += ` AND (${mimeConditions.join(' OR ')})`
  }

  if (search) {
    params.push(`%${search}%`)
    query += ` AND f.filename ILIKE $${params.length}`
  }

  if (tsFrom) {
    params.push(Number(tsFrom))
    query += ` AND f.created_at >= $${params.length}`
  }
  if (tsTo) {
    params.push(Number(tsTo))
    query += ` AND f.created_at <= $${params.length}`
  }

  // Total count
  const countQuery = query.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*)::int AS total FROM')
  const { rows: [countRow] } = await pool.query<{ total: number }>(countQuery, params)
  const total = countRow?.total || 0

  query += ` ORDER BY f.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
  params.push(limit, offset)

  const { rows } = await pool.query<{
    id: string; filename: string; content_type: string; size: number
    storage_key: string; user_id: string; channel_id: string | null
    message_id: string | null; workspace_id: string | null
    width: number | null; height: number | null; duration_ms: number | null
    thumbnail_key: string; created_at: number; uploaded_by_name: string | null
  }>(query, params)

  return NextResponse.json({
    files: rows.map(serializeFile),
    paging: { count: limit, total, page, pages: Math.ceil(total / limit) },
  })
}

interface FileRow {
  id: string; filename: string; content_type: string; size: number
  storage_key: string; user_id: string; channel_id: string | null
  message_id: string | null; workspace_id: string | null
  width: number | null; height: number | null; duration_ms: number | null
  thumbnail_key: string; created_at: number; uploaded_by_name: string | null
}

/** Map a canonical file_attachments row to the Slack-shaped files.info object. */
function serializeFile(r: FileRow) {
  return {
    id: r.id,
    name: r.filename,
    mimetype: r.content_type,
    filetype: String(r.content_type || '').split('/')[1] || 'unknown',
    size: Number(r.size) || 0,
    url_private: `/api/files/${r.id}/download`,
    permalink: `/api/files/${r.id}/download`,
    user: r.user_id,
    user_name: r.uploaded_by_name || '',
    channels: r.channel_id ? [r.channel_id] : [],
    workspace_id: r.workspace_id || '',
    width: r.width != null ? Number(r.width) : null,
    height: r.height != null ? Number(r.height) : null,
    duration_ms: r.duration_ms != null ? Number(r.duration_ms) : null,
    has_thumbnail: Boolean(r.thumbnail_key),
    created: Number(r.created_at) || 0,
  }
}

async function _DELETE(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  // Bearer token path (files:write): token IS the auth credential — skip CSRF.
  // No-token path falls through to standard session + CSRF guards.
  const scopeResult = await enforceScope(pool, req, SCOPES.FILES_WRITE)
  if (scopeResult.kind === 'error') return scopeResult.response
  let uid: string | null
  if (scopeResult.kind === 'ok') {
    uid = scopeResult.grant.user_id
  } else {
    const csrf = await verifyCsrf(req)
    if (csrf) return csrf
    uid = await readSessionUserId()
  }
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { file_id?: string }
  if (!body.file_id) return NextResponse.json({ error: 'file_id_required' }, { status: 400 })

  // Check ownership or admin against a live (not-yet-deleted) row.
  const { rows } = await pool.query<{
    user_id: string; channel_id: string | null; workspace_id: string | null
    storage_key: string; storage_backend: string | null
  }>(
    `SELECT user_id, channel_id, workspace_id, storage_key, storage_backend
       FROM aaelink.file_attachments WHERE id = $1 AND deleted_at = 0`,
    [body.file_id]
  )
  if (!rows[0]) return NextResponse.json({ error: 'file_not_found' }, { status: 404 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  const isOwner = rows[0].user_id === uid
  // 'platform_admin' is not a real role (PlatformRole union) — isPlatformAdmin
  // covers super_admin + it_admin.
  const isAdmin = isPlatformAdmin(uRows[0]?.platform_role)
  if (!isOwner && !isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // Soft delete: the row survives as the compliance/audit metadata trail
  // (who uploaded what, when, and who deleted it); the bytes and any public
  // links are removed below, and download/list/info all 404 deleted files.
  const now = Date.now()
  await pool.query(
    `UPDATE aaelink.file_attachments SET deleted_at = $1 WHERE id = $2 AND deleted_at = 0`,
    [now, body.file_id]
  )

  // Deleting a file invalidates any public share links for it: an existing
  // tokenized link must not keep serving (or exposing metadata of) a deleted
  // file to unauthenticated callers. Done here (not via revokePublicLinks, which
  // is uploader-scoped) so an admin delete also revokes.
  await pool.query(
    `UPDATE aaelink.file_public_links SET enabled = false, revoked_at = $2
      WHERE file_id = $1 AND revoked_at = 0`,
    [body.file_id, now]
  )

  // Best-effort physical cleanup (S3 object or local file). Awaited, but it
  // can never fail the request: removeFileObject swallows its own errors and
  // resolves false on miss.
  await removeFileObject(rows[0].storage_key, rows[0].storage_backend)

  writeAuditLog({
    pool,
    workspaceId: rows[0].workspace_id ?? undefined,
    actorId: uid,
    action: 'file.delete',
    resourceKind: 'file',
    resourceId: body.file_id,
    ipAddress: extractIp(req),
    metadata: { channel_id: rows[0].channel_id, owner_id: rows[0].user_id, by_admin: !isOwner && isAdmin },
  })

  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET',    '/api/files', _GET)
export const DELETE = tracedRoute('DELETE', '/api/files', _DELETE)
