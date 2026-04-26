import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readMattermostToken } from '@/lib/session'
import { getBucket, getS3Client, putObjectBytes } from '@/lib/s3'

function safeFilename(name: string) {
  const base = name.replace(/[/\\]/g, '').replace(/\.\./g, '').trim() || 'file'
  return base.slice(0, 200)
}

export async function GET() {
  const token = await readMattermostToken()
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const { rows } = await pool.query(
    `SELECT id, filename, content_type AS "contentType", size, created_at AS "createdAt"
     FROM aaelink.documents ORDER BY created_at DESC`
  )
  const documents = rows.map(r => ({
    ...r,
    createdAt: Number((r as { createdAt: string | number }).createdAt)
  }))
  return NextResponse.json({ documents })
}

export async function POST(req: Request) {
  const token = await readMattermostToken()
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const s3 = getS3Client()
  const pool = getPool()
  if (!s3 || !pool) {
    return NextResponse.json({ error: 'storage_or_database_not_configured' }, { status: 503 })
  }
  await ensureSchema()
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing_file' }, { status: 400 })
  }
  const buf = Buffer.from(await file.arrayBuffer())
  const id = randomUUID()
  const filename = safeFilename(file.name)
  const bucket = getBucket()
  const key = `documents/${id}/${filename}`
  await putObjectBytes({
    s3,
    bucket,
    key,
    body: buf,
    contentType: file.type || 'application/octet-stream'
  })
  const now = Date.now()
  await pool.query(
    `INSERT INTO aaelink.documents (id, filename, content_type, size, bucket_key, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, filename, file.type || 'application/octet-stream', buf.length, key, now]
  )
  return NextResponse.json({
    document: {
      id,
      filename,
      contentType: file.type || 'application/octet-stream',
      size: buf.length,
      createdAt: now
    }
  })
}
