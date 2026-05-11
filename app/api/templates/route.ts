import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { isWorkspaceMember } from '@/lib/workspaceAccess'
import { getS3Client, getBucket, putObjectBytes } from '@/lib/s3'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * GET    /api/templates — list document templates.
 * POST   /api/templates — upload a new template (multipart form with file + metadata).
 * PUT    /api/templates — update template metadata (JSON body).
 * DELETE /api/templates — delete a template (JSON body with id).
 */

function safeStr(v: unknown, max = 500): string {
  return String(v || '').trim().slice(0, max)
}

/** Auto-detect {{placeholder}} patterns from file content. */
function detectPlaceholders(buf: Buffer): Array<{ key: string; label: string; type: string; default: string }> {
  try {
    const text = buf.toString('utf8')
    const matches = text.match(/\{\{([^}]+)\}\}/g)
    if (!matches) return []
    const keys = [...new Set(matches.map(m => m.replace(/\{\{|\}\}/g, '').trim()))]
    return keys.map(k => ({
      key: k,
      label: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      type: 'text',
      default: '',
    }))
  } catch {
    return []
  }
}

async function _GET(req: NextRequest) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()

  const workspaceId = req.nextUrl.searchParams.get('workspace_id')?.trim()
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  if (!(await isWorkspaceMember(pool, uid, workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const category = req.nextUrl.searchParams.get('category')?.trim() || ''
  const search = req.nextUrl.searchParams.get('q')?.trim() || ''

  const where = ['workspace_id = $1']
  const params: (string | number)[] = [workspaceId]

  if (category) {
    params.push(category)
    where.push(`category = $${params.length}`)
  }
  if (search) {
    params.push(`%${search}%`)
    where.push(`(name ILIKE $${params.length} OR description ILIKE $${params.length})`)
  }

  const { rows } = await pool.query(
    `SELECT t.*, u.username AS creator_username
     FROM aaelink.document_templates t
     LEFT JOIN aaelink.users u ON u.id = t.created_by
     WHERE ${where.join(' AND ')}
     ORDER BY t.name ASC`,
    params
  )

  return NextResponse.json({
    templates: rows.map(r => ({ ...r, created_at: Number(r.created_at), updated_at: Number(r.updated_at), size_bytes: Number(r.size_bytes || 0) }))
  })
}

async function _POST(req: NextRequest) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  const s3 = getS3Client()
  if (!pool || !s3) return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  await ensureSchema()

  const form = await req.formData()
  const workspaceId = String(form.get('workspace_id') || '').trim()
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  if (!(await isWorkspaceMember(pool, uid, workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file_required' }, { status: 400 })

  const name = String(form.get('name') || file.name).trim()
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })

  const description = String(form.get('description') || '').trim()
  const category = String(form.get('category') || 'general').trim()

  // Parse placeholders from form or auto-detect from file content
  let placeholders: Array<{ key: string; label: string; type: string; default: string }> = []
  try {
    const ph = form.get('placeholders')
    if (ph) placeholders = JSON.parse(String(ph))
  } catch { /* ignore */ }

  let variables: Record<string, string> = {}
  try {
    const v = form.get('variables')
    if (v) variables = JSON.parse(String(v))
  } catch { /* ignore */ }

  const buf = Buffer.from(await file.arrayBuffer())
  const id = randomUUID()
  const filename = file.name.replace(/[/\\]/g, '').replace(/\.\./g, '').trim() || 'template'
  const key = `templates/${id}/${filename}`

  await putObjectBytes({
    s3, bucket: getBucket(), key,
    body: buf, contentType: file.type || 'application/octet-stream'
  })

  // Auto-detect placeholders if none provided
  if (placeholders.length === 0) {
    placeholders = detectPlaceholders(buf)
  }

  const now = Date.now()
  await pool.query(
    `INSERT INTO aaelink.document_templates
      (id, workspace_id, name, description, category, file_key, filename, content_type, size_bytes, placeholders, variables, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
    [id, workspaceId, name, description, category, key, filename,
     file.type || 'application/octet-stream', buf.length,
     JSON.stringify(placeholders), JSON.stringify(variables), uid, now]
  )

  return NextResponse.json({
    template: {
      id, workspace_id: workspaceId, name, description, category,
      filename, content_type: file.type || 'application/octet-stream',
      size_bytes: buf.length, placeholders, variables,
      created_at: now, updated_at: now,
    }
  })
}

// ── PUT /api/templates — update template metadata ───────────────────────────

async function _PUT(req: NextRequest) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  await ensureSchema()

  const body = await req.json() as {
    id?: string; name?: string; description?: string; category?: string;
    placeholders?: unknown; variables?: unknown; is_active?: boolean;
  }
  const id = safeStr(body.id)
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  const { rows } = await pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.document_templates WHERE id = $1`, [id]
  )
  if (!rows[0]) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!(await isWorkspaceMember(pool, uid, rows[0].workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const updates: string[] = []
  const params: (string | number)[] = []
  let pIdx = 1

  for (const field of ['name', 'description', 'category'] as const) {
    if (body[field] !== undefined) {
      updates.push(`${field} = $${pIdx}`)
      params.push(safeStr(body[field], field === 'description' ? 2000 : 200))
      pIdx++
    }
  }

  if (body.placeholders !== undefined) {
    updates.push(`placeholders = $${pIdx}`)
    params.push(JSON.stringify(body.placeholders))
    pIdx++
  }

  if (body.variables !== undefined) {
    updates.push(`variables = $${pIdx}`)
    params.push(JSON.stringify(body.variables))
    pIdx++
  }

  if (body.is_active !== undefined) {
    updates.push(`is_active = $${pIdx}`)
    params.push(body.is_active ? 'true' : 'false')
    pIdx++
  }

  if (updates.length === 0) return NextResponse.json({ error: 'no_updates' }, { status: 400 })

  updates.push(`updated_at = $${pIdx}`)
  params.push(Date.now())
  pIdx++
  params.push(id)

  await pool.query(
    `UPDATE aaelink.document_templates SET ${updates.join(', ')} WHERE id = $${pIdx - 1}`,
    params
  )

  return NextResponse.json({ ok: true })
}

// ── DELETE /api/templates — remove a template ───────────────────────────────

async function _DELETE(req: NextRequest) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  await ensureSchema()

  const { id } = await req.json() as { id?: string }
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  const { rows } = await pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.document_templates WHERE id = $1`, [id]
  )
  if (!rows[0]) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!(await isWorkspaceMember(pool, uid, rows[0].workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  await pool.query(`DELETE FROM aaelink.document_templates WHERE id = $1`, [id])
  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/templates', _GET)
export const POST   = tracedRoute('POST', '/api/templates', _POST)
export const PUT    = tracedRoute('PUT', '/api/templates', _PUT)
export const DELETE = tracedRoute('DELETE', '/api/templates', _DELETE)
