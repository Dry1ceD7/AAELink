import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { getBucket, getObjectBytes, getS3Client } from '@/lib/s3'
import { isWorkspaceMember } from '@/lib/workspaceAccess'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const s3 = getS3Client()
  const pool = getPool()
  if (!s3 || !pool) return NextResponse.json({ error: 'storage_or_database_not_configured' }, { status: 503 })
  await ensureSchema()
  const { id } = await ctx.params
  const { rows } = await pool.query(
    `SELECT filename, content_type, bucket_key, workspace_id FROM aaelink.documents WHERE id = $1`,
    [id]
  )
  const row = rows[0] as
    | { filename: string; content_type: string; bucket_key: string; workspace_id: string | null }
    | undefined
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (row.workspace_id && !(await isWorkspaceMember(pool, uid, row.workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const bytes = await getObjectBytes(s3, getBucket(), row.bucket_key)
  const safeName = row.filename.replace(/[\r\n"]/g, '_')
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': row.content_type || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeName}"`
    }
  })
}
