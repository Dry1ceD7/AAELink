import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * File Management API — Slack files.list / files.info / files.delete parity.
 *
 * GET    /api/files — list files (paginated, filterable)
 * DELETE /api/files — delete a file
 *
 * Filters: channel, user, type, date range, search.
 * Slack parity: files.list, files.info, files.delete, files.sharedPublicURL
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const fileId = req.nextUrl.searchParams.get('file_id') || ''

  // Single file info
  if (fileId) {
    const { rows } = await pool.query(
      `SELECT f.*, u.display_name AS uploaded_by_name
       FROM aaelink.files f
       LEFT JOIN aaelink.users u ON u.id = f.uploaded_by
       WHERE f.id = $1`, [fileId]
    )
    if (!rows[0]) return NextResponse.json({ error: 'file_not_found' }, { status: 404 })
    return NextResponse.json({ file: rows[0] })
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
    SELECT f.id, f.filename, f.mimetype, f.size, f.s3_key,
           f.uploaded_by, f.channel_id, f.created_at,
           u.display_name AS uploaded_by_name
    FROM aaelink.files f
    LEFT JOIN aaelink.users u ON u.id = f.uploaded_by
    WHERE 1=1
  `
  const params: unknown[] = []

  if (channelId) {
    params.push(channelId)
    query += ` AND f.channel_id = $${params.length}`
  }

  if (userId) {
    params.push(userId)
    query += ` AND f.uploaded_by = $${params.length}`
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
      return `f.mimetype LIKE $${params.length}`
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
  const countQuery = query.replace(/SELECT.*?FROM/, 'SELECT COUNT(*)::int AS total FROM')
  const { rows: [countRow] } = await pool.query<{ total: number }>(countQuery, params)
  const total = countRow?.total || 0

  query += ` ORDER BY f.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
  params.push(limit, offset)

  const { rows } = await pool.query<{
    id: string; filename: string; mimetype: string; size: number;
    s3_key: string; uploaded_by: string; channel_id: string;
    created_at: number; uploaded_by_name: string;
  }>(query, params)
  const files = rows.map(r => ({
    id: r.id,
    name: r.filename,
    mimetype: r.mimetype,
    filetype: String(r.mimetype || '').split('/')[1] || 'unknown',
    size: r.size,
    url_private: `/api/files/${r.id}/download`,
    permalink: `/api/files/${r.id}/download`,
    user: r.uploaded_by,
    user_name: r.uploaded_by_name,
    channels: r.channel_id ? [r.channel_id] : [],
    created: r.created_at,
  }))

  return NextResponse.json({
    files,
    paging: { count: limit, total, page, pages: Math.ceil(total / limit) },
  })
}

async function _DELETE(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { file_id?: string }
  if (!body.file_id) return NextResponse.json({ error: 'file_id required' }, { status: 400 })

  // Check ownership or admin
  const { rows } = await pool.query<{ uploaded_by: string }>(
    `SELECT uploaded_by FROM aaelink.files WHERE id = $1`, [body.file_id]
  )
  if (!rows[0]) return NextResponse.json({ error: 'file_not_found' }, { status: 404 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  const isOwner = rows[0].uploaded_by === uid
  const isAdmin = ['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')
  if (!isOwner && !isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  await pool.query(`DELETE FROM aaelink.files WHERE id = $1`, [body.file_id])

  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET',    '/api/files', _GET)
export const DELETE = tracedRoute('DELETE', '/api/files', _DELETE)
