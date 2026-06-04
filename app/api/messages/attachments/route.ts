// keep: slack-compat surface (intentionally addressable, may be invoked by Slack-shaped clients)
import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Message Attachments API — binds uploaded files to messages.
 *
 * POST /api/messages/attachments { message_id, file_ids[] }
 * GET  /api/messages/attachments?message_id=...
 *
 * Files are uploaded separately via /api/files/upload, then attached to
 * messages via this endpoint. This decoupling allows files to be
 * reused across messages and channels.
 */

/** GET — list attachments for a message */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const messageId = req.nextUrl.searchParams.get('message_id')?.trim() || ''
  if (!messageId) return NextResponse.json({ error: 'message_id_required' }, { status: 400 })

  // The message_attachments link table (id, message_id, file_id, sort_order)
  // is the real binding and is preserved. Only the joined file table changes:
  // canonical chat files live in aaelink.file_attachments (migration 033), not
  // aaelink.documents (which is the documents/KB subsystem). Output column
  // names are kept stable (filename/file_size/mime_type/storage_key) so
  // existing clients are unaffected. Soft-deleted files are excluded.
  const { rows } = await pool.query(`
    SELECT ma.id, ma.file_id, ma.sort_order,
           f.filename, f.size AS file_size, f.content_type AS mime_type,
           f.storage_key, f.created_at AS file_created_at
    FROM aaelink.message_attachments ma
    JOIN aaelink.file_attachments f ON f.id = ma.file_id AND f.deleted_at = 0
    WHERE ma.message_id = $1
    ORDER BY ma.sort_order ASC
  `, [messageId])

  return NextResponse.json({ attachments: rows })
}

/** POST — attach files to a message */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    message_id?: string
    file_ids?: string[]
  }

  const messageId = String(body.message_id || '').trim()
  const fileIds = Array.isArray(body.file_ids) ? body.file_ids.filter(Boolean).slice(0, 20) : []

  if (!messageId) return NextResponse.json({ error: 'message_id_required' }, { status: 400 })
  if (fileIds.length === 0) return NextResponse.json({ error: 'file_ids_required' }, { status: 400 })

  // Verify message ownership
  const { rows: msgRows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM aaelink.messages WHERE id = $1`, [messageId]
  )
  if (!msgRows[0]) return NextResponse.json({ error: 'message_not_found' }, { status: 404 })
  if (msgRows[0].user_id !== uid) return NextResponse.json({ error: 'forbidden_not_author' }, { status: 403 })

  const now = Date.now()
  const attached: string[] = []

  for (let i = 0; i < fileIds.length; i++) {
    const fileId = fileIds[i]
    const id = randomUUID()
    try {
      await pool.query(`
        INSERT INTO aaelink.message_attachments (id, message_id, file_id, sort_order, created_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (message_id, file_id) DO NOTHING
      `, [id, messageId, fileId, i, now])
      attached.push(fileId)
    } catch {
      // File might not exist — skip
    }
  }

  return NextResponse.json({ ok: true, attached_count: attached.length, file_ids: attached })
}

/** DELETE — remove an attachment from a message */
async function _DELETE(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    message_id?: string
    file_id?: string
  }

  const messageId = String(body.message_id || '').trim()
  const fileId = String(body.file_id || '').trim()

  if (!messageId || !fileId) {
    return NextResponse.json({ error: 'message_id_and_file_id_required' }, { status: 400 })
  }

  // Verify message ownership
  const { rows: msgRows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM aaelink.messages WHERE id = $1`, [messageId]
  )
  if (!msgRows[0]) return NextResponse.json({ error: 'message_not_found' }, { status: 404 })
  if (msgRows[0].user_id !== uid) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  await pool.query(
    `DELETE FROM aaelink.message_attachments WHERE message_id = $1 AND file_id = $2`,
    [messageId, fileId]
  )

  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/messages/attachments', _GET)
export const POST   = tracedRoute('POST', '/api/messages/attachments', _POST)
export const DELETE = tracedRoute('DELETE', '/api/messages/attachments', _DELETE)
