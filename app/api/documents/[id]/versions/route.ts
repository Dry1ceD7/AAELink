import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { isWorkspaceMember } from '@/lib/workspaceAccess'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * GET /api/documents/[id]/versions — list all versions for a document.
 */
async function _GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  await ensureSchema()
  const { id: documentId } = await ctx.params

  // Verify document exists and user has access
  const { rows: docRows } = await pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.documents WHERE id = $1`,
    [documentId]
  )
  const doc = docRows[0]
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!(await isWorkspaceMember(pool, uid, doc.workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { rows } = await pool.query<{
    id: string
    version_number: number
    filename: string
    content_type: string
    size_bytes: number
    change_summary: string
    created_by: string
    created_at: number
    creator_username?: string
  }>(
    `SELECT v.id, v.version_number, v.filename, v.content_type, v.size_bytes,
            v.change_summary, v.created_by, v.created_at,
            u.username AS creator_username
     FROM aaelink.document_versions v
     LEFT JOIN aaelink.users u ON u.id = v.created_by
     WHERE v.document_id = $1
     ORDER BY v.version_number DESC`,
    [documentId]
  )

  return NextResponse.json({
    versions: rows.map(r => ({
      ...r,
      created_at: Number(r.created_at),
      size_bytes: Number(r.size_bytes),
    }))
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/documents/:id/versions', _GET)
