import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readMattermostToken } from '@/lib/session'
import { getBucket, getObjectBytes, getS3Client } from '@/lib/s3'

const STIRLING_URL = process.env.STIRLING_URL || 'http://localhost:8085'

export async function POST(req: Request) {
  const token = await readMattermostToken()
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const incoming = await req.formData()
  const documentId = String(incoming.get('document_id') || '').trim()
  let file: File | null = null

  if (documentId) {
    const pool = getPool()
    const s3 = getS3Client()
    if (!pool || !s3) return NextResponse.json({ error: 'storage_or_database_not_configured' }, { status: 503 })
    await ensureSchema()
    const { rows } = await pool.query(
      `SELECT filename, content_type, bucket_key FROM aaelink.documents WHERE id = $1`,
      [documentId]
    )
    const row = rows[0] as { filename: string; content_type: string; bucket_key: string } | undefined
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const bytes = await getObjectBytes(s3, getBucket(), row.bucket_key)
    file = new File([new Uint8Array(bytes)], row.filename, { type: row.content_type || 'application/pdf' })
  } else {
    const f = incoming.get('file')
    if (!(f instanceof File)) {
      return NextResponse.json({ error: 'missing_file_or_document_id' }, { status: 400 })
    }
    file = f
  }

  const out = new FormData()
  out.set('fileInput', file)
  out.set('languages', String(incoming.get('languages') || 'eng'))

  const res = await fetch(`${STIRLING_URL}/api/v1/misc/ocr-pdf`, {
    method: 'POST',
    body: out
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'ocr_failed' }, { status: 502 })
  }

  const base = file.name.replace(/\.pdf$/i, '') || 'document'
  return new Response(await res.arrayBuffer(), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${base}-ocr.pdf"`
    }
  })
}
