import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isWorkspaceMember } from '@/lib/workspace/workspaceAccess'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { verifyCsrf } from '@/lib/auth/csrf'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { drivePipeline } from '@/lib/documents/puzzleBox/pipeline'
import type { PuzzlePiece, PipelineStage } from '@/lib/documents/puzzleBox/types'

async function _POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf

  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()

  const { id } = await ctx.params
  const { rows } = await pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.document_assemblies WHERE id = $1`, [id]
  )
  const a = rows[0]
  if (!a) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!(await isWorkspaceMember(pool, uid, a.workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    raw_text?: string
    prebuilt_piece?: PuzzlePiece
    source_kind?: 'upload' | 'email' | 'manual' | 'ticket'
    source_ref?: string
    strategy?: 'regex' | 'llm' | 'auto'
    stop_after?: PipelineStage
  }

  const result = await drivePipeline({
    pool,
    assembly_id: id,
    raw_text: body.raw_text,
    prebuilt_piece: body.prebuilt_piece,
    source_kind: body.source_kind,
    source_ref: body.source_ref,
    strategy: body.strategy,
    stop_after: body.stop_after,
  })

  writeAuditLog({
    pool, workspaceId: a.workspace_id, actorId: uid,
    action: 'document.assembly.ingest',
    resourceKind: 'document_assembly', resourceId: id,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { stage: result.stage, error: result.error || undefined, strategy: body.strategy || 'auto' },
  })

  return NextResponse.json({ assembly: result })
}

export const POST = tracedRoute('POST', '/api/documents/assemblies/[id]/ingest', _POST)
