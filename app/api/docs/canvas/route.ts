import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { userCanReadChannel } from '@/lib/enterprise/collab-access'
import { resolveCanvasAccess, loadCanvas, isPlatformAdminUser, canAdministerCanvas, canvasListReadPredicate, resolveTemplateBlocks, resolveCanvasWorkspace } from '@/lib/knowledge/canvasAccess'
import { parseBlocks, checkBlocksPayload, MAX_SHARED_WITH } from '@/lib/knowledge/canvasSections'
import { emitKnowledgeEvent } from '@/lib/knowledge/knowledgeRealtime'

/**
 * Canvas / Collaborative Documents API — freeform structured docs within channels.
 *
 * GET    /api/docs/canvas — list canvases (global, channel, or personal)
 * POST   /api/docs/canvas — create a new canvas
 * PUT    /api/docs/canvas — update canvas content (requires write access)
 * DELETE /api/docs/canvas — soft-delete a canvas (creator or platform admin)
 *
 * Canvas types:
 *   - channel_canvas — embedded in a channel, visible to channel members
 *   - personal_note  — private to the creator
 *   - shared_doc     — shared with specific users/channels
 *   - template       — reusable starting points (workspace-readable)
 *
 * Access is resolved by lib/knowledge/canvasAccess — including the canvas_access
 * grant table, which is now read (it used to be inert).
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const channelId = req.nextUrl.searchParams.get('channel_id') || ''
  const type = req.nextUrl.searchParams.get('type') || ''
  const mine = req.nextUrl.searchParams.get('mine') === 'true'
  const id = req.nextUrl.searchParams.get('id') || ''

  // Single-canvas lookup with full content_blocks (used by the editor on mount).
  if (id) {
    const access = await resolveCanvasAccess(pool, uid, id)
    if (!access.canvas || access.deleted) {
      return NextResponse.json({ error: 'canvas_not_found' }, { status: 404 })
    }
    if (!access.canRead) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

    const { rows } = await pool.query(
      `SELECT c.id, c.title, c.type, c.channel_id, c.icon, c.cover_image,
              c.is_pinned, c.is_template, c.shared_with,
              c.content_blocks,
              c.word_count, c.block_count,
              c.created_by, u.username AS author, c.created_at, c.updated_at,
              c.last_edited_by, u2.username AS last_editor
         FROM aaelink.canvases c
         LEFT JOIN aaelink.users u ON u.id = c.created_by
         LEFT JOIN aaelink.users u2 ON u2.id = c.last_edited_by
        WHERE c.id = $1
        LIMIT 1`,
      [id]
    )
    const c = rows[0]
    if (!c) return NextResponse.json({ error: 'canvas_not_found' }, { status: 404 })
    return NextResponse.json({
      canvas: {
        ...c,
        content_blocks:
          typeof c.content_blocks === 'string'
            ? JSON.parse(c.content_blocks || '[]')
            : (c.content_blocks ?? []),
        can_write: access.canWrite,
        created_at: Number(c.created_at),
        updated_at: Number(c.updated_at || 0),
      },
    })
  }

  // List view. When scoped to a channel, the caller must be able to read it —
  // otherwise we never surface that channel's canvases. All filters are
  // parameterized (the old code interpolated `uid` straight into the WHERE).
  let where = 'WHERE c.deleted_at = 0'
  const params: string[] = []

  if (channelId) {
    if (!(await userCanReadChannel(pool, uid, channelId))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    params.push(channelId)
    where += ` AND c.channel_id = $${params.length}`
  }
  if (mine) {
    params.push(uid)
    where += ` AND c.created_by = $${params.length}`
  }
  if (['channel_canvas', 'personal_note', 'shared_doc', 'template'].includes(type)) {
    params.push(type)
    where += ` AND c.type = $${params.length}`
  }

  // Access predicate. When listing "mine" the created_by filter already scopes
  // it; otherwise restrict to canvases the user can see (creator / template /
  // shared_with / canvas_access user-grant / readable channel_canvas) — see
  // lib/knowledge/canvasAccess#canvasListReadPredicate.
  if (!mine) {
    params.push(uid)
    where += ` AND ${canvasListReadPredicate(params.length)}`
  }

  const { rows } = await pool.query(
    `SELECT c.id, c.title, c.type, c.channel_id, c.icon, c.cover_image,
            c.is_pinned, c.is_template,
            c.word_count, c.block_count,
            c.created_by, u.username AS author, c.created_at, c.updated_at,
            c.last_edited_by, u2.username AS last_editor
       FROM aaelink.canvases c
       LEFT JOIN aaelink.users u ON u.id = c.created_by
       LEFT JOIN aaelink.users u2 ON u2.id = c.last_edited_by
       ${where}
       ORDER BY c.updated_at DESC
       LIMIT 100`,
    params
  )

  return NextResponse.json({
    canvases: rows.map((c) => ({ ...c, created_at: Number(c.created_at), updated_at: Number(c.updated_at || 0) })),
    total: rows.length,
  })
}

async function _POST(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    title?: string; type?: string; channel_id?: string
    icon?: string; cover_image?: string
    content_blocks?: Array<{ type: string; content?: string; [k: string]: unknown }>
    shared_with?: string[]
    is_template?: boolean
    from_template_id?: string
  }

  const title = String(body.title || 'Untitled Canvas').trim()
  const VALID_TYPES = ['channel_canvas', 'personal_note', 'shared_doc', 'template']
  const type = VALID_TYPES.includes(body.type || '') ? body.type! : 'personal_note'

  // A channel canvas may only be created by someone who can read the channel,
  // otherwise an outsider could seed content into a private channel's canvas tab.
  if (type === 'channel_canvas') {
    if (!body.channel_id) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })
    if (!(await userCanReadChannel(pool, uid, body.channel_id))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }

  // Template instantiate: copy a readable template's content_blocks into the new
  // canvas (server-side, via the access engine). The new canvas is owned by the
  // caller and is NOT itself a template.
  let templateBlocks: Array<{ type: string; content?: string; [k: string]: unknown }> | null = null
  const fromTemplateId = String(body.from_template_id || '').trim()
  if (fromTemplateId) {
    const tpl = await resolveTemplateBlocks(pool, uid, fromTemplateId)
    if (!tpl.ok) {
      return NextResponse.json({ error: tpl.code }, { status: tpl.code === 'forbidden' ? 403 : 404 })
    }
    templateBlocks = tpl.blocks
  }

  const rawBlocks = templateBlocks
    ? templateBlocks
    : Array.isArray(body.content_blocks) ? body.content_blocks : [{ type: 'paragraph', content: '' }]
  // Stamp a stable id on every block at the write boundary so sections (= blocks)
  // are addressable by id on every later read — the Sections API and the editor
  // both update/delete/reorder by block id.
  const blocks = parseBlocks(rawBlocks)

  // Size caps: reject oversized payloads before persisting.
  const cap = checkBlocksPayload(blocks)
  if (cap) return NextResponse.json({ error: cap }, { status: 413 })
  const sharedWith = Array.isArray(body.shared_with) ? body.shared_with : []
  if (sharedWith.length > MAX_SHARED_WITH) {
    return NextResponse.json({ error: 'too_many_shares' }, { status: 413 })
  }

  const wordCount = blocks.reduce(
    (sum, b) => sum + String(b.content || '').split(/\s+/).filter(Boolean).length,
    0
  )

  const id = randomUUID()
  const now = Date.now()
  const workspaceId = await resolveCanvasWorkspace(pool, uid, { type, channelId: body.channel_id })

  await pool.query(
    `INSERT INTO aaelink.canvases
       (id, title, type, channel_id, workspace_id, icon, cover_image,
        content_blocks, word_count, block_count,
        shared_with, is_pinned, is_template,
        created_by, last_edited_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, $12, $13, $13, $14, $14)`,
    [
      id, title, type, body.channel_id || null, workspaceId,
      body.icon || '📄', body.cover_image || '',
      JSON.stringify(blocks), wordCount, blocks.length,
      JSON.stringify(sharedWith), body.is_template || false,
      uid, now,
    ]
  )

  writeAuditLog({
    pool, actorId: uid, action: 'canvas.create', resourceKind: 'canvas', resourceId: id,
    ipAddress: extractIp(req),
    metadata: { type, channel_id: body.channel_id || '', ...(fromTemplateId ? { from_template: fromTemplateId } : {}) },
  })

  // Channel canvases broadcast to the channel. Channel-less canvases (personal
  // notes) have no realtime consumer today, so emitKnowledgeEvent no-ops on them
  // (owner-topic delivery isn't wired client-side — see knowledgeRealtime).
  await emitKnowledgeEvent(
    { kind: 'canvas.updated', canvas_id: id, channel_id: body.channel_id || '', updated_at: now },
    { channelId: body.channel_id, ownerId: uid }
  )

  return NextResponse.json(
    { canvas: { id, title, type, block_count: blocks.length, word_count: wordCount, created_at: now } },
    { status: 201 }
  )
}

async function _PUT(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    canvas_id?: string; title?: string
    content_blocks?: Array<{ type: string; content?: string; [k: string]: unknown }>
    icon?: string; cover_image?: string
    is_pinned?: boolean; shared_with?: string[]
  }

  const canvasId = String(body.canvas_id || '').trim()
  if (!canvasId) return NextResponse.json({ error: 'canvas_id_required' }, { status: 400 })

  const access = await resolveCanvasAccess(pool, uid, canvasId)
  if (!access.canvas || access.deleted) {
    return NextResponse.json({ error: 'canvas_not_found' }, { status: 404 })
  }
  if (!access.canWrite) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const updates: string[] = []
  const params: unknown[] = []

  if (body.title) { params.push(body.title); updates.push(`title = $${params.length}`) }
  if (body.icon) { params.push(body.icon); updates.push(`icon = $${params.length}`) }
  if (body.cover_image !== undefined) { params.push(body.cover_image); updates.push(`cover_image = $${params.length}`) }
  if (body.is_pinned !== undefined) { params.push(body.is_pinned); updates.push(`is_pinned = $${params.length}`) }
  if (body.shared_with) {
    if (body.shared_with.length > MAX_SHARED_WITH) {
      return NextResponse.json({ error: 'too_many_shares' }, { status: 413 })
    }
    // Sharing is owner-controlled: a write-grant lets you edit content, not
    // widen the audience. Only the canvas administrator may change shared_with.
    if (!(await canAdministerCanvas(pool, uid, access.canvas))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    params.push(JSON.stringify(body.shared_with)); updates.push(`shared_with = $${params.length}`)
  }

  if (body.content_blocks) {
    // Stamp stable ids and enforce the size cap before persisting.
    const blocks = parseBlocks(body.content_blocks)
    const cap = checkBlocksPayload(blocks)
    if (cap) return NextResponse.json({ error: cap }, { status: 413 })
    const wordCount = blocks.reduce(
      (sum, b) => sum + String(b.content || '').split(/\s+/).filter(Boolean).length,
      0
    )
    params.push(JSON.stringify(blocks)); updates.push(`content_blocks = $${params.length}`)
    params.push(wordCount); updates.push(`word_count = $${params.length}`)
    params.push(blocks.length); updates.push(`block_count = $${params.length}`)
  }

  if (updates.length === 0) return NextResponse.json({ error: 'no_updates' }, { status: 400 })

  const now = Date.now()
  params.push(uid); updates.push(`last_edited_by = $${params.length}`)
  params.push(now); updates.push(`updated_at = $${params.length}`)
  params.push(canvasId)

  const { rowCount } = await pool.query(
    `UPDATE aaelink.canvases SET ${updates.join(', ')} WHERE id = $${params.length} AND deleted_at = 0`,
    params
  )
  if (!rowCount) return NextResponse.json({ error: 'canvas_not_found' }, { status: 404 })

  writeAuditLog({
    pool, actorId: uid, action: 'canvas.update', resourceKind: 'canvas', resourceId: canvasId,
    ipAddress: extractIp(req),
  })

  await emitKnowledgeEvent(
    { kind: 'canvas.updated', canvas_id: canvasId, channel_id: access.canvas.channel_id || '', updated_at: now },
    { channelId: access.canvas.channel_id, ownerId: access.canvas.created_by }
  )

  return NextResponse.json({ ok: true, updated_at: now })
}

async function _DELETE(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Accept canvas_id from body or ?id= for convenience.
  const body = (await req.json().catch(() => ({}))) as { canvas_id?: string }
  const canvasId = String(body.canvas_id || req.nextUrl.searchParams.get('id') || '').trim()
  if (!canvasId) return NextResponse.json({ error: 'canvas_id_required' }, { status: 400 })

  const canvas = await loadCanvas(pool, canvasId)
  if (!canvas || canvas.deleted_at !== 0) {
    return NextResponse.json({ error: 'canvas_not_found' }, { status: 404 })
  }

  // Only the creator or a platform admin may delete. We soft-delete (tombstone)
  // rather than purge: canvases are compliance-scoped content and a hard delete
  // would erase the audit/retention trail. The row is excluded from every read
  // path via deleted_at = 0 guards.
  const isCreator = canvas.created_by === uid
  if (!isCreator && !(await isPlatformAdminUser(pool, uid))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const now = Date.now()
  await pool.query(
    `UPDATE aaelink.canvases SET deleted_at = $1, last_edited_by = $2, updated_at = $1 WHERE id = $3`,
    [now, uid, canvasId]
  )

  writeAuditLog({
    pool, actorId: uid, action: 'canvas.delete', resourceKind: 'canvas', resourceId: canvasId,
    ipAddress: extractIp(req), metadata: { soft: true, by_admin: !isCreator },
  })

  await emitKnowledgeEvent(
    { kind: 'canvas.deleted', canvas_id: canvasId, channel_id: canvas.channel_id || '', deleted_at: now },
    { channelId: canvas.channel_id, ownerId: canvas.created_by }
  )

  return NextResponse.json({ ok: true, deleted_at: now })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/docs/canvas', _GET)
export const POST   = tracedRoute('POST', '/api/docs/canvas', _POST)
export const PUT    = tracedRoute('PUT', '/api/docs/canvas', _PUT)
export const DELETE = tracedRoute('DELETE', '/api/docs/canvas', _DELETE)
