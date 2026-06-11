import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { userCanReadChannel } from '@/lib/enterprise/collab-access'
import { isFileAccessAllowed } from '@/lib/files/scanGate'
import { readFileBytes } from '@/lib/files/storage'
import { buildServeHeaders } from '@/lib/files/serveHeaders'
import { tracedRoute } from '@/lib/api/tracedRoute'

/** GET /api/files/[id]/download — download a file attachment. */
async function _GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params

  const { rows } = await pool.query<{
    filename: string; content_type: string; storage_key: string
    storage_backend: string | null; size: string
    user_id: string; channel_id: string | null; deleted_at: string
  }>(
    `SELECT filename, content_type, storage_key, storage_backend, size::text,
            user_id, channel_id, deleted_at::text
       FROM aaelink.file_attachments WHERE id = $1`,
    [id]
  )
  const att = rows[0]
  if (!att || Number(att.deleted_at) !== 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // Access: the uploader always; channel-attached files require channel read
  // access; unattached uploads are private to the uploader until shared.
  if (att.user_id !== uid) {
    const allowed = att.channel_id
      ? await userCanReadChannel(pool, uid, att.channel_id)
      : false
    if (!allowed) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Virus-scan gate (D12): never serve an infected file; strict policy also
  // blocks not-yet-scanned files.
  if (!(await isFileAccessAllowed(pool, id))) {
    return NextResponse.json({ error: 'file_blocked_by_scan' }, { status: 403 })
  }

  // Resolve bytes via the recorded backend (S3 or local disk).
  const buffer = await readFileBytes(att.storage_key, att.storage_backend)
  if (!buffer) {
    return NextResponse.json({ error: 'file_missing' }, { status: 404 })
  }

  // Active-content types (text/html, SVG, …) are neutralized to an attachment
  // download as application/octet-stream with nosniff; inline-safe media keeps
  // its declared type so previews work.
  return new NextResponse(new Uint8Array(buffer), {
    headers: buildServeHeaders({
      contentType: att.content_type,
      filename: att.filename,
      size: buffer.length,
      cacheControl: 'private, max-age=3600',
    }),
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/files/:id/download', _GET)
