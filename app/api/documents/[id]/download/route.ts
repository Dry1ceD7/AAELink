import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readMattermostToken } from '@/lib/session'
import { getBucket, getObjectBytes, getS3Client } from '@/lib/s3'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readMattermostToken()
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const s3 = getS3Client()
  const pool = getPool()
  if (!s3 || !pool) return NextResponse.json({ error: 'storage_or_database_not_configured' }, { status: 503 })
  await ensureSchema()
  const { id } = await ctx.params
  const { rows } = await pool.query(
    `SELECT filename, content_type, bucket_key FROM aaelink.documents WHERE id = $1`,
    [id]
  )
  const row = rows[0] as { filename: string; content_type: string; bucket_key: string } | undefined
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const bytes = await getObjectBytes(s3, getBucket(), row.bucket_key)
  const safeName = row.filename.replace(/[\r\n"]/g, '_')
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': row.content_type || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeName}"`
    }
  })
}
