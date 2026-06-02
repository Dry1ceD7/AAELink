import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isWorkspaceMember } from '@/lib/workspace/workspaceAccess'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { verifyCsrf } from '@/lib/auth/csrf'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { getS3Client, getBucket, deleteObject } from '@/lib/infra/s3'
import { isSlot, type SlotOverrides } from '@/lib/documents/puzzleBox/blocks'

function sanitiseOverrides(input: unknown): SlotOverrides {
  if (!input || typeof input !== 'object') return {}
  const out: SlotOverrides = {}
  let count = 0
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (count >= 200) break
    if (typeof key !== 'string' || key.length > 200) continue
    if (!isSlot(value)) continue
    out[key] = value
    count++
  }
  return out
}

async function _GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()

  const { id } = await ctx.params

  const { rows } = await pool.query<{
    id: string; workspace_id: string; template_id: string | null;
    client_profile_id: string | null; piece: string;
    stage: string; rendered_html: string; output_bucket_key: string;
    delivery_channel_id: string | null; delivery_message_id: string;
    error: string; created_by: string | null;
    ticket_id: string | null;
    overrides: Record<string, unknown> | string | null;
    created_at: string; updated_at: string;
  }>(
    `SELECT id, workspace_id, template_id, client_profile_id, piece, stage,
            rendered_html, output_bucket_key, delivery_channel_id,
            delivery_message_id, error, created_by, ticket_id, overrides,
            created_at, updated_at
     FROM aaelink.document_assemblies WHERE id = $1`, [id]
  )
  const a = rows[0]
  if (!a) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!(await isWorkspaceMember(pool, uid, a.workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { rows: logRows } = await pool.query<{
    id: string; stage: string; status: string; duration_ms: number;
    detail: string; created_at: string;
  }>(
    `SELECT id, stage, status, duration_ms, detail, created_at
     FROM aaelink.document_pipeline_log
     WHERE assembly_id = $1
     ORDER BY created_at ASC`, [id]
  )

  return NextResponse.json({
    assembly: {
      ...a,
      piece: a.piece ? JSON.parse(a.piece) : null,
      overrides: typeof a.overrides === 'string'
        ? JSON.parse(a.overrides || '{}')
        : (a.overrides || {}),
      created_at: Number(a.created_at),
      updated_at: Number(a.updated_at),
    },
    log: logRows.map(r => ({
      ...r,
      detail: r.detail ? JSON.parse(r.detail) : {},
      created_at: Number(r.created_at),
    })),
  })
}

/**
 * PATCH /api/documents/assemblies/[id]
 *
 * Update fields a workspace member is allowed to change *before* the document
 * is rendered: per-document slot overrides, target client, delivery channel,
 * ticket linkage. After stage='rendered' or 'delivered' the row is locked
 * — we don't want to edit history.
 */
async function _PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf

  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()

  const { id } = await ctx.params
  const { rows } = await pool.query<{ workspace_id: string; stage: string }>(
    `SELECT workspace_id, stage FROM aaelink.document_assemblies WHERE id = $1`, [id]
  )
  const a = rows[0]
  if (!a) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!(await isWorkspaceMember(pool, uid, a.workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (a.stage === 'rendered' || a.stage === 'delivered') {
    return NextResponse.json({ error: 'assembly_locked', hint: 'Cannot edit after render. Discard and create a new one.' }, { status: 409 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    overrides?: unknown
    client_profile_id?: string | null
    delivery_channel_id?: string | null
    ticket_id?: string | null
  }

  const sets: string[] = ['updated_at = $2']
  const params: (string | number | null)[] = [id, Date.now()]

  if (body.overrides !== undefined) {
    const overrides = sanitiseOverrides(body.overrides)
    params.push(JSON.stringify(overrides))
    sets.push(`overrides = $${params.length}::jsonb`)
  }
  if (body.client_profile_id !== undefined) {
    params.push(body.client_profile_id || null)
    sets.push(`client_profile_id = $${params.length}`)
  }
  if (body.delivery_channel_id !== undefined) {
    params.push(body.delivery_channel_id || null)
    sets.push(`delivery_channel_id = $${params.length}`)
  }
  if (body.ticket_id !== undefined) {
    params.push(body.ticket_id || null)
    sets.push(`ticket_id = $${params.length}`)
  }

  if (sets.length === 1) {
    return NextResponse.json({ error: 'no_updates' }, { status: 400 })
  }

  await pool.query(`UPDATE aaelink.document_assemblies SET ${sets.join(', ')} WHERE id = $1`, params)

  writeAuditLog({
    pool, workspaceId: a.workspace_id, actorId: uid,
    action: 'document.assembly.update',
    resourceKind: 'document_assembly', resourceId: id,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { fields: Object.keys(body).filter(k => (body as Record<string, unknown>)[k] !== undefined) },
  })

  return NextResponse.json({ ok: true })
}

/**
 * DELETE /api/documents/assemblies/[id] — discard the assembly + log + S3 PDF.
 */
async function _DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf

  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
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

  if (a.output_bucket_key) {
    try {
      const s3 = getS3Client()
      if (s3) await deleteObject(s3, getBucket(), a.output_bucket_key)
    } catch (err: unknown) {
      console.error('[assemblies/delete] s3:', err)
    }
  }

  await pool.query(`DELETE FROM aaelink.document_assemblies WHERE id = $1`, [id])

  writeAuditLog({
    pool, workspaceId: a.workspace_id, actorId: uid,
    action: 'document.assembly.delete',
    resourceKind: 'document_assembly', resourceId: id,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { had_output: !!a.output_bucket_key },
  })

  return NextResponse.json({ ok: true })
}

export const GET = tracedRoute('GET', '/api/documents/assemblies/[id]', _GET)
export const PATCH = tracedRoute('PATCH', '/api/documents/assemblies/[id]', _PATCH)
export const DELETE = tracedRoute('DELETE', '/api/documents/assemblies/[id]', _DELETE)
