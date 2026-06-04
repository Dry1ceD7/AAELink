// keep: slack-compat surface (intentionally addressable, may be invoked by Slack-shaped clients)
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { resolveCanvasAccess } from '@/lib/knowledge/canvasAccess'
import {
  createSection, updateSection, deleteSection, reorderSections, parseBlocks,
  type SectionOpResult,
} from '@/lib/knowledge/canvasSections'
import { emitKnowledgeEvent } from '@/lib/knowledge/knowledgeRealtime'

/**
 * Canvas Sections API — Slack canvases.sections parity.
 *
 * Stage B unification: sections now operate ON the canvas content_blocks array
 * (a "section" is a block with a stable `id`), NOT the parallel canvas_sections
 * table. canvas GET returns content_blocks, so reads and writes finally agree —
 * the previous write-only split-brain (canvas_sections written but never read) is
 * gone. The canvas_sections table is retired from the write path (left in place
 * for rollback only). See lib/knowledge/canvasSections for the block helpers.
 *
 * GET  /api/docs/canvas/sections?canvas_id=...  — list sections (= blocks) [read]
 * POST /api/docs/canvas/sections — create/update/delete/reorder sections [write]
 *   Actions: create, update, delete, reorder
 *   Optimistic concurrency: pass `expected_updated_at` (the updated_at the client
 *   last saw); a mismatch yields 409 stale_canvas so concurrent edits don't clobber.
 *
 * Access is resolved through lib/knowledge/canvasAccess so this surface shares the
 * exact read/write rules as the main canvas (no separate, unguarded model).
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const canvasId = req.nextUrl.searchParams.get('canvas_id') || ''
  if (!canvasId) return NextResponse.json({ error: 'canvas_id_required' }, { status: 400 })

  const access = await resolveCanvasAccess(pool, uid, canvasId)
  if (!access.canvas || access.deleted) {
    return NextResponse.json({ error: 'canvas_not_found' }, { status: 404 })
  }
  if (!access.canRead) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // Sections ARE the content blocks. Read them from the canvas row (single source
  // of truth) and surface position by array index for callers that want it.
  // Normalize through parseBlocks so EVERY block — including the seed block and
  // any block authored via the main canvas editor (which may have no `id`) — gets
  // a stable, addressable id, instead of returning a raw, possibly-undefined b.id.
  const { rows } = await pool.query<{ content_blocks: unknown; updated_at: string | number }>(
    `SELECT content_blocks, updated_at FROM aaelink.canvases WHERE id = $1 AND deleted_at = 0`,
    [canvasId]
  )
  const blocks = parseBlocks(rows[0]?.content_blocks)
  const sections = blocks.map((b, i) => ({
    id: b.id,
    section_type: b.type ?? 'paragraph',
    title: b.title ?? '',
    content: b.content ?? '',
    position: i,
  }))

  return NextResponse.json({ sections, updated_at: Number(rows[0]?.updated_at || 0) })
}

/** Map a section-op result to an HTTP response, emitting on success. */
async function respond(
  res: SectionOpResult,
  ctx: { canvasId: string; channelId: string | null; ownerId: string | null; extra?: Record<string, unknown> }
): Promise<NextResponse> {
  if (!res.ok) {
    const status =
      res.code === 'stale_canvas' ? 409 :
      res.code === 'payload_too_large' ? 413 :
      res.code === 'too_many_blocks' ? 413 :
      res.code === 'canvas_not_found' ? 404 : 404
    return NextResponse.json({ error: res.code }, { status })
  }
  await emitKnowledgeEvent(
    { kind: 'canvas.updated', canvas_id: ctx.canvasId, channel_id: ctx.channelId || '', updated_at: res.updated_at },
    { channelId: ctx.channelId, ownerId: ctx.ownerId }
  )
  return NextResponse.json({ ok: true, updated_at: res.updated_at, ...(res.section_id ? { section_id: res.section_id } : {}), ...(ctx.extra || {}) })
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
    action?: string
    canvas_id?: string
    section_id?: string
    section_type?: string
    title?: string
    content?: string
    position?: number
    sections_order?: string[]
    expected_updated_at?: number
  }

  const { action, canvas_id } = body
  if (!canvas_id) return NextResponse.json({ error: 'canvas_id_required' }, { status: 400 })

  const access = await resolveCanvasAccess(pool, uid, canvas_id)
  if (!access.canvas || access.deleted) {
    return NextResponse.json({ error: 'canvas_not_found' }, { status: 404 })
  }
  if (!access.canWrite) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const channelId = access.canvas.channel_id
  const ownerId = access.canvas.created_by
  const ip = extractIp(req)
  const audit = (act: string, meta?: Record<string, unknown>) =>
    writeAuditLog({ pool, actorId: uid, action: act, resourceKind: 'canvas', resourceId: canvas_id, ipAddress: ip, metadata: meta })

  if (action === 'create') {
    const res = await createSection(pool, canvas_id, uid, {
      section_type: body.section_type, title: body.title, content: body.content,
      position: body.position, expected_updated_at: body.expected_updated_at,
    })
    if (res.ok) audit('canvas.section_create', { section_id: res.section_id })
    return respond(res, { canvasId: canvas_id, channelId, ownerId })
  }

  if (action === 'update') {
    if (!body.section_id) return NextResponse.json({ error: 'section_id_required' }, { status: 400 })
    const res = await updateSection(pool, canvas_id, uid, body.section_id, {
      section_type: body.section_type, title: body.title, content: body.content,
      expected_updated_at: body.expected_updated_at,
    })
    if (res.ok) audit('canvas.section_update', { section_id: body.section_id })
    return respond(res, { canvasId: canvas_id, channelId, ownerId })
  }

  if (action === 'delete') {
    if (!body.section_id) return NextResponse.json({ error: 'section_id_required' }, { status: 400 })
    const res = await deleteSection(pool, canvas_id, uid, body.section_id, body.expected_updated_at)
    if (res.ok) audit('canvas.section_delete', { section_id: body.section_id })
    return respond(res, { canvasId: canvas_id, channelId, ownerId })
  }

  if (action === 'reorder') {
    const order = body.sections_order || []
    const res = await reorderSections(pool, canvas_id, uid, order, body.expected_updated_at)
    if (res.ok) audit('canvas.section_reorder', { count: order.length })
    return respond(res, { canvasId: canvas_id, channelId, ownerId, extra: { reordered: order.length } })
  }

  return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
}

export const GET  = tracedRoute('GET',  '/api/docs/canvas/sections', _GET)
export const POST = tracedRoute('POST', '/api/docs/canvas/sections', _POST)
