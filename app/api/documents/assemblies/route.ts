import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isWorkspaceMember } from '@/lib/workspace/workspaceAccess'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { verifyCsrf } from '@/lib/auth/csrf'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import type { SlotOverrides } from '@/lib/documents/puzzleBox/blocks'
import { isSlot } from '@/lib/documents/puzzleBox/blocks'

/**
 * Sanitise a free-form override map: keys must be `<block_id>.<input_path>`
 * and every value must be a Slot. We bound size to avoid abuse.
 */
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

async function _GET(req: NextRequest) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()

  const url = new URL(req.url)
  const wsId = url.searchParams.get('workspace_id')?.trim()
  if (!wsId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  if (!(await isWorkspaceMember(pool, uid, wsId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const stage = url.searchParams.get('stage')?.trim() || ''
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200)

  const params: (string | number)[] = [wsId]
  let where = 'workspace_id = $1'
  if (stage) { params.push(stage); where += ` AND stage = $${params.length}` }
  params.push(limit)

  const { rows } = await pool.query<{
    id: string; workspace_id: string; template_id: string | null; client_profile_id: string | null;
    stage: string; output_bucket_key: string; delivery_channel_id: string | null;
    delivery_message_id: string; error: string; created_by: string | null;
    ticket_id: string | null;
    created_at: string; updated_at: string;
  }>(
    `SELECT id, workspace_id, template_id, client_profile_id, stage,
            output_bucket_key, delivery_channel_id, delivery_message_id,
            error, created_by, ticket_id, created_at, updated_at
     FROM aaelink.document_assemblies
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  )

  return NextResponse.json({
    assemblies: rows.map(r => ({ ...r, created_at: Number(r.created_at), updated_at: Number(r.updated_at) })),
  })
}

async function _POST(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf

  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()

  const body = (await req.json().catch(() => ({}))) as {
    workspace_id?: string
    template_id?: string
    client_profile_id?: string | null
    delivery_channel_id?: string | null
    piece?: unknown
    ticket_id?: string | null
    /** Per-document slot overrides (block-tree path). */
    overrides?: unknown
  }

  const wsId = String(body.workspace_id || '').trim()
  if (!wsId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  if (!(await isWorkspaceMember(pool, uid, wsId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const overrides = sanitiseOverrides(body.overrides)

  const id = randomUUID()
  const now = Date.now()
  await pool.query(
    `INSERT INTO aaelink.document_assemblies
       (id, workspace_id, template_id, client_profile_id, piece, stage,
        delivery_channel_id, ticket_id, overrides, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,'ingested',$6,$7,$8::jsonb,$9,$10,$10)`,
    [
      id, wsId,
      body.template_id || null,
      body.client_profile_id || null,
      JSON.stringify(body.piece || {}),
      body.delivery_channel_id || null,
      body.ticket_id || null,
      JSON.stringify(overrides),
      uid, now,
    ]
  )

  writeAuditLog({
    pool, workspaceId: wsId, actorId: uid,
    action: 'document.assembly.create',
    resourceKind: 'document_assembly', resourceId: id,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: {
      template_id: body.template_id || null,
      ticket_id: body.ticket_id || null,
      overrides_count: Object.keys(overrides).length,
    },
  })

  return NextResponse.json({
    assembly: {
      id, workspace_id: wsId, stage: 'ingested',
      ticket_id: body.ticket_id || null,
      overrides,
      created_at: now, updated_at: now,
    },
  })
}

export const GET = tracedRoute('GET', '/api/documents/assemblies', _GET)
export const POST = tracedRoute('POST', '/api/documents/assemblies', _POST)
