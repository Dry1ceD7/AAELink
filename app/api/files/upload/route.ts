import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import path from 'path'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { storeFileBytes } from '@/lib/files/storage'
import { enqueueUploadJobs } from '@/lib/files/fileJobs'
import { getScanPolicy } from '@/lib/files/scanGate'
import { checkUploadPolicy, SINGLE_SHOT_MAX_BYTES } from '@/lib/files/uploadPolicy'
import { emitFileUploaded } from '@/lib/webhooks/webhookEmitter'
import { log } from '@/lib/infra/log'

/**
 * POST /api/files/upload — upload a file attachment for a message.
 * Multipart form: file, channel_id, message_id (optional - can link after message creation)
 */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const formData = await req.formData().catch(() => null)
  if (!formData) return NextResponse.json({ error: 'invalid_form_data' }, { status: 400 })

  const file = formData.get('file') as File | null
  const channelId = String(formData.get('channel_id') || '').trim()
  const messageId = String(formData.get('message_id') || '').trim()

  // Slack flow: a file can be uploaded BEFORE it is attached to a message or
  // even associated with a channel (getUploadURLExternal → completeUploadExternal).
  // Only the file itself is mandatory; channel_id / message_id are optional.
  if (!file) {
    return NextResponse.json({ error: 'file_required' }, { status: 400 })
  }

  // Enforce the org scan policy BEFORE storing bytes: a policy size cap REPLACES
  // the hardcoded 50MB default when set (max_file_size_mb > 0), otherwise the
  // built-in default applies; blocked extensions are rejected outright. The same
  // policy shape drives the access gate and the post-upload pipeline.
  const policy = await getScanPolicy(pool)
  const check = checkUploadPolicy(
    { filename: file.name, size: file.size, defaultMaxBytes: SINGLE_SHOT_MAX_BYTES },
    policy
  )
  if (!check.ok) {
    return check.error === 'file_too_large'
      ? NextResponse.json({ error: 'file_too_large', max: check.max }, { status: 413 })
      : NextResponse.json({ error: 'extension_blocked', extension: check.extension }, { status: 415 })
  }

  // Resolve the owning workspace from the channel when one is provided, so the
  // row is workspace-scoped for list/info/delete.
  let workspaceId: string | null = null
  if (channelId) {
    const { rows } = await pool.query<{ workspace_id: string }>(
      `SELECT workspace_id FROM aaelink.channels WHERE id = $1`, [channelId]
    )
    workspaceId = rows[0]?.workspace_id ?? null
  }

  const id = randomUUID()
  const ext = path.extname(file.name) || ''
  const localKey = `${id}${ext}`
  const contentType = file.type || 'application/octet-stream'

  // Persist bytes via the storage abstraction: S3 when configured, local disk
  // otherwise (dev + tests without S3 env stay on disk). The chosen backend +
  // its key are recorded so download/scan/index/delete resolve the same bytes.
  const buffer = Buffer.from(await file.arrayBuffer())
  const { backend, storageKey } = await storeFileBytes({
    fileId: id,
    filename: file.name,
    contentType,
    body: buffer,
    localKey,
  })

  const now = Date.now()

  // Always persist the canonical file row (migration 033 relaxed the
  // message_id/channel_id NOT NULLs), so an unattached upload is no longer an
  // orphan invisible to /api/files. message_id/channel_id stay null until the
  // file is bound to a message.
  await pool.query(
    `INSERT INTO aaelink.file_attachments
       (id, message_id, channel_id, workspace_id, user_id, filename, content_type, size, storage_key, storage_backend, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      messageId || null,
      channelId || null,
      workspaceId,
      uid,
      file.name,
      contentType,
      file.size,
      storageKey,
      backend,
      now,
    ]
  )

  // Fan out file.uploaded to subscribed outgoing webhooks + Events-API
  // subscriptions (no-op when none configured). Best-effort: a delivery-queue
  // hiccup must never fail the upload.
  try {
    await emitFileUploaded(pool, {
      file_id: id,
      filename: file.name,
      size: file.size,
      user_id: uid,
      channel_id: channelId || undefined,
      workspace_id: workspaceId || undefined,
    })
  } catch (err) {
    log.error('file upload: emitFileUploaded failed', {
      name: 'files.upload.emit',
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // Fire-and-forget the post-upload pipeline (virus scan + content index). A
  // queue hiccup must never fail the upload, so enqueue errors are swallowed.
  try {
    await enqueueUploadJobs(pool, {
      fileId: id,
      filename: file.name,
      fileSize: file.size,
      mimeType: contentType,
      uploadedBy: uid,
    })
  } catch (err) {
    log.error('file upload: enqueue pipeline jobs failed', {
      name: 'files.upload.enqueue',
      error: err instanceof Error ? err.message : String(err),
    })
  }

  return NextResponse.json({
    attachment: {
      id,
      filename: file.name,
      content_type: file.type || 'application/octet-stream',
      size: file.size,
      storage_key: storageKey,
      download_url: `/api/files/${id}/download`
    }
  })
}

/** GET /api/files/upload?message_id=... — get attachments for a message. */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const messageId = req.nextUrl.searchParams.get('message_id') || ''
  const channelId = req.nextUrl.searchParams.get('channel_id') || ''

  if (!messageId && !channelId) {
    return NextResponse.json({ error: 'message_id_or_channel_id_required' }, { status: 400 })
  }

  let query: string
  let params: string[]

  if (messageId) {
    query = `SELECT id, message_id, filename, content_type, size, storage_key, created_at
             FROM aaelink.file_attachments WHERE message_id = $1 AND deleted_at = 0 ORDER BY created_at ASC`
    params = [messageId]
  } else {
    query = `SELECT id, message_id, filename, content_type, size, storage_key, created_at
             FROM aaelink.file_attachments WHERE channel_id = $1 AND deleted_at = 0 ORDER BY created_at DESC LIMIT 50`
    params = [channelId]
  }

  const { rows } = await pool.query(query, params)
  return NextResponse.json({
    attachments: rows.map((r: Record<string, unknown>) => ({
      ...r,
      download_url: `/api/files/${r.id}/download`
    }))
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/files/upload', _GET)
export const POST   = tracedRoute('POST', '/api/files/upload', _POST)
