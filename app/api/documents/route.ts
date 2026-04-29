import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { getBucket, getS3Client, putObjectBytes } from '@/lib/s3'
import { isWorkspaceMember } from '@/lib/workspaceAccess'

function safeFilename(name: string) {
  const base = name.replace(/[/\\]/g, '').replace(/\.\./g, '').trim() || 'file'
  return base.slice(0, 200)
}

export async function GET(req: Request) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const workspaceId = new URL(req.url).searchParams.get('workspace_id')?.trim()
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  }
  if (!(await isWorkspaceMember(pool, uid, workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const { rows } = await pool.query(
    `SELECT id, filename, content_type AS "contentType", size, created_at AS "createdAt"
     FROM aaelink.documents WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [workspaceId]
  )
  const documents = rows.map(r => ({
    ...r,
    createdAt: Number((r as { createdAt: string | number }).createdAt)
  }))
  return NextResponse.json({ documents })
}

export async function POST(req: Request) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const s3 = getS3Client()
  const pool = getPool()
  if (!s3 || !pool) {
    return NextResponse.json({ error: 'storage_or_database_not_configured' }, { status: 503 })
  }
  await ensureSchema()
  const form = await req.formData()
  const workspaceId = String(form.get('workspace_id') || '').trim()
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  }
  if (!(await isWorkspaceMember(pool, uid, workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
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
    `INSERT INTO aaelink.documents (id, workspace_id, filename, content_type, size, bucket_key, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, workspaceId, filename, file.type || 'application/octet-stream', buf.length, key, now]
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
