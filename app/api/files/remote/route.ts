// keep: slack-compat surface (intentionally addressable, may be invoked by Slack-shaped clients)
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { Pool } from 'pg'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Files Remote API — Slack files.remote.* parity.
 *
 * External file references — register external URLs as "files" within AAELink
 * without actually uploading them. Used for Google Drive, OneDrive, Box,
 * Dropbox, etc. integrations.
 *
 * GET  /api/files/remote — list remote files
 * POST /api/files/remote — add/update/remove a remote file reference
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const externalId = req.nextUrl.searchParams.get('external_id') || ''
  const channelId = req.nextUrl.searchParams.get('channel_id') || ''
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') || 50), 200)
  const cursor = req.nextUrl.searchParams.get('cursor') || ''

  await ensureRemoteFilesTable(pool)

  if (externalId) {
    const { rows } = await pool.query(
      `SELECT * FROM aaelink.files_remote WHERE external_id = $1`, [externalId]
    )
    if (!rows[0]) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ file: rows[0] })
  }

  let query = `SELECT * FROM aaelink.files_remote WHERE 1=1`
  const params: unknown[] = []

  if (channelId) {
    params.push(channelId)
    query += ` AND $${params.length} = ANY(channels)`
  }
  if (cursor) {
    params.push(cursor)
    query += ` AND id > $${params.length}`
  }

  query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`
  params.push(limit + 1)

  const { rows } = await pool.query(query, params)
  const hasMore = rows.length > limit
  const files = rows.slice(0, limit)

  return NextResponse.json({
    files,
    response_metadata: {
      next_cursor: hasMore ? String(files[files.length - 1]?.id || '') : '',
    },
  })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  await ensureRemoteFilesTable(pool)

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'add' | 'update' | 'remove' | 'share'
    external_id?: string; external_url?: string; title?: string
    filetype?: string; preview_image?: string; indexable_text?: string
    channel_id?: string
  }

  const action = body.action || 'add'

  if (action === 'add') {
    if (!body.external_id || !body.external_url) {
      return NextResponse.json({ error: 'external_id and external_url required' }, { status: 400 })
    }
    const id = randomUUID()
    const now = Date.now()

    await pool.query(`
      INSERT INTO aaelink.files_remote
        (id, external_id, external_url, title, filetype, preview_image, indexable_text,
         channels, created_by, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (external_id) DO UPDATE SET
        external_url = $3, title = $4, filetype = $5,
        preview_image = $6, indexable_text = $7
    `, [
      id, body.external_id, body.external_url,
      body.title || body.external_url,
      body.filetype || 'link',
      body.preview_image || '',
      body.indexable_text || '',
      body.channel_id ? [body.channel_id] : [],
      uid, now,
    ])

    return NextResponse.json({ ok: true, file: { id, external_id: body.external_id } }, { status: 201 })
  }

  if (action === 'update') {
    if (!body.external_id) return NextResponse.json({ error: 'external_id required' }, { status: 400 })
    const updates: string[] = []
    const params: unknown[] = []

    if (body.title) { params.push(body.title); updates.push(`title = $${params.length}`) }
    if (body.external_url) { params.push(body.external_url); updates.push(`external_url = $${params.length}`) }
    if (body.filetype) { params.push(body.filetype); updates.push(`filetype = $${params.length}`) }
    if (body.preview_image) { params.push(body.preview_image); updates.push(`preview_image = $${params.length}`) }
    if (body.indexable_text) { params.push(body.indexable_text); updates.push(`indexable_text = $${params.length}`) }

    if (updates.length === 0) return NextResponse.json({ ok: true, message: 'nothing to update' })

    params.push(body.external_id)
    await pool.query(
      `UPDATE aaelink.files_remote SET ${updates.join(', ')} WHERE external_id = $${params.length}`, params
    )
    return NextResponse.json({ ok: true })
  }

  if (action === 'remove') {
    if (!body.external_id) return NextResponse.json({ error: 'external_id required' }, { status: 400 })
    await pool.query(`DELETE FROM aaelink.files_remote WHERE external_id = $1`, [body.external_id])
    return NextResponse.json({ ok: true })
  }

  if (action === 'share') {
    if (!body.external_id || !body.channel_id) {
      return NextResponse.json({ error: 'external_id and channel_id required' }, { status: 400 })
    }
    await pool.query(`
      UPDATE aaelink.files_remote
      SET channels = array_append(channels, $1)
      WHERE external_id = $2 AND NOT ($1 = ANY(channels))
    `, [body.channel_id, body.external_id])
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'action must be add/update/remove/share' }, { status: 400 })
}

async function ensureRemoteFilesTable(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.files_remote (
      id              TEXT PRIMARY KEY,
      external_id     TEXT UNIQUE NOT NULL,
      external_url    TEXT NOT NULL DEFAULT '',
      title           TEXT NOT NULL DEFAULT '',
      filetype        TEXT NOT NULL DEFAULT 'link',
      preview_image   TEXT NOT NULL DEFAULT '',
      indexable_text  TEXT NOT NULL DEFAULT '',
      channels        TEXT[] NOT NULL DEFAULT '{}',
      created_by      TEXT NOT NULL DEFAULT '',
      created_at      BIGINT NOT NULL DEFAULT 0
    );
  `)
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/files/remote', _GET)
export const POST   = tracedRoute('POST', '/api/files/remote', _POST)
