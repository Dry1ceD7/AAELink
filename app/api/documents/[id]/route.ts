import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { getS3Client, getBucket, deleteObject } from '@/lib/s3'
import { isWorkspaceMember } from '@/lib/workspaceAccess'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const pool = getPool()
  const s3 = getS3Client()
  if (!pool || !s3) {
    return NextResponse.json({ error: 'storage_or_database_not_configured' }, { status: 503 })
  }
  await ensureSchema()

  const { id } = await params

  // Fetch the document record to verify ownership/membership and get the S3 key
  const { rows } = await pool.query(
    `SELECT workspace_id, bucket_key FROM aaelink.documents WHERE id = $1`,
    [id]
  )
  if (rows.length === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const doc = rows[0] as { workspace_id: string; bucket_key: string }

  // Check that the user is a member of this workspace
  if (!(await isWorkspaceMember(pool, uid, doc.workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Delete from S3
  try {
    await deleteObject(s3, getBucket(), doc.bucket_key)
  } catch (err) {
    console.error('[documents/delete] S3 delete error:', err)
    // Continue to delete the DB record even if S3 fails
  }

  // Delete from DB
  await pool.query(`DELETE FROM aaelink.documents WHERE id = $1`, [id])

  return NextResponse.json({ ok: true })
}
