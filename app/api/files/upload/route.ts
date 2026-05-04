import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import fs from 'fs'
import path from 'path'

const UPLOAD_DIR = process.env.AAELINK_UPLOAD_DIR || path.join(process.cwd(), '.uploads')
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

/**
 * POST /api/files/upload — upload a file attachment for a message.
 * Multipart form: file, channel_id, message_id (optional - can link after message creation)
 */
export async function POST(req: NextRequest) {
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

  if (!file || !channelId) {
    return NextResponse.json({ error: 'file_and_channel_id_required' }, { status: 400 })
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'file_too_large', max: MAX_FILE_SIZE }, { status: 413 })
  }

  // Ensure upload directory exists
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })

  const id = randomUUID()
  const ext = path.extname(file.name) || ''
  const storageKey = `${id}${ext}`
  const destPath = path.join(UPLOAD_DIR, storageKey)

  // Write file to disk
  const buffer = Buffer.from(await file.arrayBuffer())
  fs.writeFileSync(destPath, buffer)

  const now = Date.now()

  // If message_id is provided, link the attachment to the message
  if (messageId) {
    await pool.query(
      `INSERT INTO aaelink.file_attachments (id, message_id, channel_id, user_id, filename, content_type, size, storage_key, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, messageId, channelId, uid, file.name, file.type || 'application/octet-stream', file.size, storageKey, now]
    )
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
export async function GET(req: NextRequest) {
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
             FROM aaelink.file_attachments WHERE message_id = $1 ORDER BY created_at ASC`
    params = [messageId]
  } else {
    query = `SELECT id, message_id, filename, content_type, size, storage_key, created_at
             FROM aaelink.file_attachments WHERE channel_id = $1 ORDER BY created_at DESC LIMIT 50`
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
