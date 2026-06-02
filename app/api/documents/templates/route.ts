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
import { validateDocument, type DocumentTree, type PageSize } from '@/lib/documents/puzzleBox/blocks'

/**
 * Puzzle Box document_templates surface.
 *
 * Templates ship with a structured `block_tree` (schema_version=2) — the
 * editor-driven puzzle layout. The legacy `html_source` / `css_source` path
 * is preserved for backwards compatibility but is excluded from the picker
 * and gradually deprecated.
 *
 * Endpoints:
 *   GET   /api/documents/templates   — list templates for a workspace
 *   POST  /api/documents/templates   — create a new versioned template (admin)
 *   PATCH /api/documents/templates   — toggle is_active / rename / replace block_tree (admin)
 */

interface TemplateRow {
  id: string
  workspace_id: string
  kind: string
  name: string
  version: number
  html_source: string
  css_source: string
  required_fields: string[] | string
  page_size: string
  is_active: boolean
  created_at: string
  schema_version: string
  block_tree: DocumentTree | string | null
  style_tokens: Record<string, string> | string
}

function parseBlockTree(raw: TemplateRow['block_tree']): DocumentTree | null {
  if (!raw) return null
  if (typeof raw === 'string') {
    if (raw === 'null' || raw === '') return null
    try {
      const parsed = JSON.parse(raw) as DocumentTree | null
      return parsed?.schema_version === '2' ? parsed : null
    } catch { return null }
  }
  return raw.schema_version === '2' ? raw : null
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

  const kind = url.searchParams.get('kind')?.trim() || ''
  const includeInactive = url.searchParams.get('include_inactive') === '1'
  const includeBlockTree = url.searchParams.get('with_tree') === '1'

  const params: (string | number)[] = [wsId]
  let where = 'workspace_id = $1'
  if (!includeInactive) where += ' AND is_active = true'
  // Filter out legacy binary uploads (TemplatesPanel.tsx). Block-tree templates
  // (schema_version='2') and HTML templates with content both pass.
  where += " AND (kind <> 'binary' OR html_source <> '' OR schema_version = '2')"
  if (kind) { params.push(kind); where += ` AND kind = $${params.length}` }

  const cols = includeBlockTree
    ? `id, workspace_id, kind, name, version, html_source, css_source,
       required_fields, page_size, is_active, created_at,
       schema_version, block_tree, style_tokens`
    : `id, workspace_id, kind, name, version, html_source, css_source,
       required_fields, page_size, is_active, created_at,
       schema_version, NULL::jsonb AS block_tree, style_tokens`

  const { rows } = await pool.query<TemplateRow>(
    `SELECT ${cols}
     FROM aaelink.document_templates WHERE ${where}
     ORDER BY kind, version DESC, name`,
    params
  )

  return NextResponse.json({
    templates: rows.map(r => ({
      ...r,
      required_fields: Array.isArray(r.required_fields) ? r.required_fields : JSON.parse(String(r.required_fields || '[]')),
      created_at: Number(r.created_at),
      block_tree: includeBlockTree ? parseBlockTree(r.block_tree) : null,
      style_tokens: typeof r.style_tokens === 'string'
        ? JSON.parse(r.style_tokens || '{}')
        : (r.style_tokens || {}),
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

  const { rows: roleRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!isPlatformAdmin(roleRows[0]?.platform_role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    workspace_id?: string
    kind?: string
    name?: string
    page_size?: PageSize
    required_fields?: string[]
    /** Block-tree template (schema_version='2'). Preferred path. */
    block_tree?: DocumentTree | null
    style_tokens?: Record<string, string>
    /** Legacy: HTML/CSS source. Kept for migration of older templates. */
    html_source?: string
    css_source?: string
  }

  const wsId = String(body.workspace_id || '').trim()
  const kind = String(body.kind || '').trim()
  const name = String(body.name || '').trim()
  if (!wsId || !kind || !name) {
    return NextResponse.json({ error: 'workspace_id_kind_name_required' }, { status: 400 })
  }

  // ── Block-tree validation (when supplied) ────────────────────────────
  let schemaVersion: '1' | '2' = '1'
  let blockTreeJson: string = 'null'
  if (body.block_tree && body.block_tree.schema_version === '2') {
    const issues = validateDocument(body.block_tree)
    const blocking = issues.filter(i => i.code !== 'orphan_block' && i.code !== 'overflow')
    if (blocking.length) {
      return NextResponse.json({
        error: 'invalid_block_tree',
        issues: blocking,
      }, { status: 400 })
    }
    schemaVersion = '2'
    blockTreeJson = JSON.stringify(body.block_tree)
  }

  const { rows: verRows } = await pool.query<{ max_version: number }>(
    `SELECT COALESCE(MAX(version), 0) AS max_version
     FROM aaelink.document_templates WHERE workspace_id = $1 AND kind = $2`,
    [wsId, kind]
  )
  const nextVersion = (verRows[0]?.max_version || 0) + 1

  const id = randomUUID()
  const now = Date.now()
  const required = Array.isArray(body.required_fields) ? body.required_fields.map(String).slice(0, 64) : []
  const styleTokens = (body.style_tokens && typeof body.style_tokens === 'object') ? body.style_tokens : {}

  await pool.query(
    `INSERT INTO aaelink.document_templates
       (id, workspace_id, kind, name, version, html_source, css_source,
        required_fields, page_size, is_active, created_at, created_by,
        schema_version, block_tree, style_tokens)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11,$12,$13::jsonb,$14::jsonb)`,
    [
      id, wsId, kind, name, nextVersion,
      String(body.html_source || ''),
      String(body.css_source || ''),
      JSON.stringify(required),
      body.page_size || 'A4',
      now, uid,
      schemaVersion,
      blockTreeJson,
      JSON.stringify(styleTokens),
    ]
  )

  writeAuditLog({
    pool, workspaceId: wsId, actorId: uid,
    action: 'document.template.create',
    resourceKind: 'document_template', resourceId: id,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { kind, version: nextVersion, required_count: required.length, schema_version: schemaVersion },
  })

  return NextResponse.json({
    template: {
      id, workspace_id: wsId, kind, name, version: nextVersion,
      page_size: body.page_size || 'A4', is_active: true, created_at: now,
      schema_version: schemaVersion,
    },
  })
}

async function _PATCH(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf

  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()

  const { rows: roleRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!isPlatformAdmin(roleRows[0]?.platform_role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    id?: string
    is_active?: boolean
    name?: string
    block_tree?: DocumentTree | null
    style_tokens?: Record<string, string>
    required_fields?: string[]
  }

  const id = String(body.id || '').trim()
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  const { rows } = await pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.document_templates WHERE id = $1`, [id]
  )
  if (!rows[0]) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const sets: string[] = []
  const params: (string | boolean | number)[] = [id]

  if (body.is_active !== undefined) { params.push(body.is_active); sets.push(`is_active = $${params.length}`) }
  if (body.name !== undefined) { params.push(String(body.name).trim().slice(0, 200)); sets.push(`name = $${params.length}`) }

  if (body.block_tree !== undefined) {
    if (body.block_tree && body.block_tree.schema_version === '2') {
      const issues = validateDocument(body.block_tree)
      const blocking = issues.filter(i => i.code !== 'orphan_block' && i.code !== 'overflow')
      if (blocking.length) {
        return NextResponse.json({ error: 'invalid_block_tree', issues: blocking }, { status: 400 })
      }
      params.push(JSON.stringify(body.block_tree))
      sets.push(`block_tree = $${params.length}::jsonb`)
      params.push('2')
      sets.push(`schema_version = $${params.length}`)
    } else if (body.block_tree === null) {
      params.push('null')
      sets.push(`block_tree = $${params.length}::jsonb`)
    }
  }

  if (body.style_tokens !== undefined) {
    params.push(JSON.stringify(body.style_tokens || {}))
    sets.push(`style_tokens = $${params.length}::jsonb`)
  }

  if (body.required_fields !== undefined) {
    params.push(JSON.stringify(Array.isArray(body.required_fields) ? body.required_fields.map(String).slice(0, 64) : []))
    sets.push(`required_fields = $${params.length}::jsonb`)
  }

  if (sets.length === 0) return NextResponse.json({ error: 'no_updates' }, { status: 400 })

  await pool.query(`UPDATE aaelink.document_templates SET ${sets.join(', ')} WHERE id = $1`, params)

  writeAuditLog({
    pool, workspaceId: rows[0].workspace_id, actorId: uid,
    action: 'document.template.update',
    resourceKind: 'document_template', resourceId: id,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { fields: Object.keys(body).filter(k => k !== 'id') },
  })

  return NextResponse.json({ ok: true })
}

export const GET = tracedRoute('GET', '/api/documents/templates', _GET)
export const POST = tracedRoute('POST', '/api/documents/templates', _POST)
export const PATCH = tracedRoute('PATCH', '/api/documents/templates', _PATCH)
