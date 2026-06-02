import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isWorkspaceMember } from '@/lib/workspace/workspaceAccess'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { getS3Client, getBucket, getObjectBytes } from '@/lib/infra/s3'

/**
 * GET /api/documents/assemblies/[id]/download
 *
 * Streams the rendered PDF for an assembly in stage='rendered' or
 * stage='delivered'. Returns 404 if the assembly hasn't reached render yet.
 */
async function _GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const pool = getPool()
  const s3 = getS3Client()
  if (!pool || !s3) return NextResponse.json({ error: 'storage_or_database_not_configured' }, { status: 503 })
  await ensureSchema()

  const { id } = await ctx.params
  const { rows } = await pool.query<{ workspace_id: string; output_bucket_key: string }>(
    `SELECT workspace_id, output_bucket_key FROM aaelink.document_assemblies WHERE id = $1`,
    [id]
  )
  const a = rows[0]
  if (!a) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!(await isWorkspaceMember(pool, uid, a.workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (!a.output_bucket_key) {
    return NextResponse.json({ error: 'not_yet_rendered' }, { status: 404 })
  }

  const bytes = await getObjectBytes(s3, getBucket(), a.output_bucket_key)
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${id}.pdf"`,
    },
  })
}

export const GET = tracedRoute('GET', '/api/documents/assemblies/[id]/download', _GET)
