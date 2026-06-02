import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isWorkspaceMember } from '@/lib/workspace/workspaceAccess'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { verifyCsrf } from '@/lib/auth/csrf'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { SEED_TEMPLATES, findSeedTemplateByKind } from '@/lib/documents/puzzleBox/seedTemplates'

/**
 * POST /api/documents/templates/seed
 *
 * Insert a starter template into the workspace from the SEED_TEMPLATES
 * catalogue. Admins use this on first run to bootstrap the Documents
 * module — picking the bundled "Order Confirmation" gets the workspace a
 * working puzzle layout in one click.
 *
 * GET returns the catalogue.
 */

async function _GET() {
  return NextResponse.json({
    seeds: SEED_TEMPLATES.map(t => ({
      kind: t.kind,
      name: t.name,
      description: t.description,
      page_size: t.page_size,
      block_count: Object.keys(t.block_tree.blocks).length,
    })),
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
    seed_kind?: string
    name_override?: string
  }

  const wsId = String(body.workspace_id || '').trim()
  if (!wsId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  if (!(await isWorkspaceMember(pool, uid, wsId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Admin only — seed templates plant default workspace branding.
  const { rows: roleRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!isPlatformAdmin(roleRows[0]?.platform_role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const seed = findSeedTemplateByKind(String(body.seed_kind || ''))
  if (!seed) return NextResponse.json({ error: 'unknown_seed' }, { status: 400 })

  const { rows: verRows } = await pool.query<{ max_version: number }>(
    `SELECT COALESCE(MAX(version), 0) AS max_version
     FROM aaelink.document_templates WHERE workspace_id = $1 AND kind = $2`,
    [wsId, seed.kind]
  )
  const nextVersion = (verRows[0]?.max_version || 0) + 1

  const id = randomUUID()
  const now = Date.now()
  const name = String(body.name_override || seed.name).slice(0, 200)

  await pool.query(
    `INSERT INTO aaelink.document_templates
       (id, workspace_id, kind, name, version, html_source, css_source,
        required_fields, page_size, is_active, created_at, created_by,
        schema_version, block_tree, style_tokens)
     VALUES ($1,$2,$3,$4,$5,'','',$6::jsonb,$7,true,$8,$9,'2',$10::jsonb,$11::jsonb)`,
    [
      id, wsId, seed.kind, name, nextVersion,
      JSON.stringify(seed.required_fields),
      seed.page_size,
      now, uid,
      JSON.stringify(seed.block_tree),
      JSON.stringify(seed.style_tokens),
    ]
  )

  writeAuditLog({
    pool, workspaceId: wsId, actorId: uid,
    action: 'document.template.seed',
    resourceKind: 'document_template', resourceId: id,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { seed_kind: seed.kind, version: nextVersion },
  })

  return NextResponse.json({
    template: {
      id, workspace_id: wsId, kind: seed.kind, name,
      version: nextVersion, page_size: seed.page_size,
      schema_version: '2',
      created_at: now,
    },
  })
}

export const GET = tracedRoute('GET', '/api/documents/templates/seed', _GET)
export const POST = tracedRoute('POST', '/api/documents/templates/seed', _POST)
