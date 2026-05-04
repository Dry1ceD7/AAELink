import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import fs from 'fs'
import path from 'path'

const UPLOAD_DIR = process.env.AAELINK_UPLOAD_DIR || path.join(process.cwd(), '.uploads')

/** GET /api/files/[id]/download — download a file attachment. */
export async function GET(
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
    filename: string; content_type: string; storage_key: string; size: string
  }>(
    `SELECT filename, content_type, storage_key, size::text FROM aaelink.file_attachments WHERE id = $1`,
    [id]
  )
  const att = rows[0]
  if (!att) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const filePath = path.join(UPLOAD_DIR, att.storage_key)
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'file_missing' }, { status: 404 })
  }

  const buffer = fs.readFileSync(filePath)
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': att.content_type,
      'Content-Disposition': `inline; filename="${att.filename.replace(/"/g, '_')}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'private, max-age=3600'
    }
  })
}
