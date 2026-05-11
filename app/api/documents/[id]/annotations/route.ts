import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { isWorkspaceMember } from '@/lib/workspaceAccess'
import { tracedRoute } from '@/lib/tracedRoute'

type AnnotationType = 'highlight' | 'sticky_note' | 'freehand' | 'stamp' | 'comment' | 'text_markup' | 'redaction_mark'

function isAnnotationType(v: string): v is AnnotationType {
  return ['highlight', 'sticky_note', 'freehand', 'stamp', 'comment', 'text_markup', 'redaction_mark'].includes(v)
}

/**
 * GET /api/documents/[id]/annotations — list annotations for a document.
 * POST /api/documents/[id]/annotations — create annotation.
 * PATCH /api/documents/[id]/annotations — update annotation.
 * DELETE /api/documents/[id]/annotations — delete annotation.
 */

async function _GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const { id: docId } = await ctx.params

  // Verify document exists and user has access
  const { rows: docRows } = await pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.documents WHERE id = $1`, [docId]
  )
  if (!docRows[0]) return NextResponse.json({ error: 'document_not_found' }, { status: 404 })
  if (!(await isWorkspaceMember(pool, uid, docRows[0].workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const page = req.nextUrl.searchParams.get('page')

  const where = ['a.document_id = $1']
  const params: (string | number)[] = [docId]

  if (page) {
    params.push(Number(page))
    where.push(`a.page_number = $${params.length}`)
  }

  const { rows } = await pool.query(
    `SELECT a.*, u.username AS author_username, u.avatar_url AS author_avatar
     FROM aaelink.document_annotations a
     LEFT JOIN aaelink.users u ON u.id = a.author_id
     WHERE ${where.join(' AND ')}
     ORDER BY a.page_number, a.created_at`,
    params
  )

  return NextResponse.json({
    annotations: rows.map(r => ({ ...r, created_at: Number(r.created_at), updated_at: Number(r.updated_at) }))
  })
}

async function _POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const { id: docId } = await ctx.params

  const { rows: docRows } = await pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.documents WHERE id = $1`, [docId]
  )
  if (!docRows[0]) return NextResponse.json({ error: 'document_not_found' }, { status: 404 })
  if (!(await isWorkspaceMember(pool, uid, docRows[0].workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as {
    type?: string
    page_number?: number
    content?: string
    coordinates?: Record<string, unknown>
    style?: Record<string, unknown>
    parent_id?: string
  }

  const type = body.type && isAnnotationType(body.type) ? body.type : 'highlight'
  const pageNumber = Math.max(Number(body.page_number) || 1, 1)
  const content = String(body.content || '').trim()
  const coordinates = body.coordinates && typeof body.coordinates === 'object' ? body.coordinates : {}
  const style = body.style && typeof body.style === 'object' ? body.style : {}
  const parentId = String(body.parent_id || '').trim()

  const now = Date.now()
  const id = randomUUID()

  await pool.query(
    `INSERT INTO aaelink.document_annotations
      (id, document_id, page_number, type, content, coordinates, style, author_id, parent_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
    [id, docId, pageNumber, type, content, JSON.stringify(coordinates),
     JSON.stringify(style), uid, parentId, now]
  )

  const { rows: uRows } = await pool.query<{ username: string; avatar_url: string }>(
    `SELECT username, avatar_url FROM aaelink.users WHERE id = $1`, [uid]
  )

  return NextResponse.json({
    annotation: {
      id, document_id: docId, page_number: pageNumber, type, content,
      coordinates, style, author_id: uid, parent_id: parentId,
      resolved: false, created_at: now, updated_at: now,
      author_username: uRows[0]?.username, author_avatar: uRows[0]?.avatar_url,
    }
  })
}

async function _PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const { id: docId } = await ctx.params

  const body = (await req.json()) as {
    annotation_id?: string
    content?: string
    resolved?: boolean
    coordinates?: Record<string, unknown>
    style?: Record<string, unknown>
  }

  const annotationId = String(body.annotation_id || '').trim()
  if (!annotationId) return NextResponse.json({ error: 'annotation_id_required' }, { status: 400 })

  // Verify ownership
  const { rows } = await pool.query<{ author_id: string; document_id: string }>(
    `SELECT author_id, document_id FROM aaelink.document_annotations WHERE id = $1`, [annotationId]
  )
  if (!rows[0]) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (rows[0].document_id !== docId) return NextResponse.json({ error: 'document_mismatch' }, { status: 400 })

  const now = Date.now()
  const updates: string[] = ['updated_at = $2']
  const params: (string | number | boolean)[] = [annotationId, now]

  if (body.content !== undefined) {
    params.push(String(body.content)); updates.push(`content = $${params.length}`)
  }
  if (body.resolved !== undefined) {
    params.push(Boolean(body.resolved)); updates.push(`resolved = $${params.length}`)
  }
  if (body.coordinates !== undefined) {
    params.push(JSON.stringify(body.coordinates)); updates.push(`coordinates = $${params.length}`)
  }
  if (body.style !== undefined) {
    params.push(JSON.stringify(body.style)); updates.push(`style = $${params.length}`)
  }

  await pool.query(
    `UPDATE aaelink.document_annotations SET ${updates.join(', ')} WHERE id = $1`, params
  )

  return NextResponse.json({ ok: true })
}

async function _DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const { id: docId } = await ctx.params

  const body = (await req.json()) as { annotation_id?: string }
  const annotationId = String(body.annotation_id || '').trim()
  if (!annotationId) return NextResponse.json({ error: 'annotation_id_required' }, { status: 400 })

  // Only author or workspace admins can delete
  const { rows } = await pool.query<{ author_id: string; document_id: string }>(
    `SELECT author_id, document_id FROM aaelink.document_annotations WHERE id = $1`, [annotationId]
  )
  if (!rows[0]) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (rows[0].document_id !== docId) return NextResponse.json({ error: 'document_mismatch' }, { status: 400 })
  if (rows[0].author_id !== uid) {
    // Check if admin
    const { rows: docRows } = await pool.query<{ workspace_id: string }>(
      `SELECT workspace_id FROM aaelink.documents WHERE id = $1`, [docId]
    )
    const { rows: pr } = await pool.query<{ platform_role: string }>(
      `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
    )
    if (pr[0]?.platform_role !== 'super_admin') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }

  await pool.query(`DELETE FROM aaelink.document_annotations WHERE id = $1`, [annotationId])
  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/documents/:id/annotations', _GET)
export const POST   = tracedRoute('POST', '/api/documents/:id/annotations', _POST)
export const PATCH  = tracedRoute('PATCH', '/api/documents/:id/annotations', _PATCH)
export const DELETE = tracedRoute('DELETE', '/api/documents/:id/annotations', _DELETE)
