// keep: slack-compat surface (intentionally addressable, may be invoked by Slack-shaped clients)
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { userCanReadChannel } from '@/lib/enterprise/collab-access'
import { resolveCanvasWorkspace } from '@/lib/knowledge/canvasAccess'
import { emitKnowledgeEvent } from '@/lib/knowledge/knowledgeRealtime'

/**
 * Conversations Canvases API — Slack conversations.canvases parity.
 *
 * This is now a THIN COMPAT SURFACE over aaelink.canvases (Stage B consolidation).
 * The old second backend (conversation_canvases → aaelink.documents) is retired:
 * migration 036 converted any legacy links into channel_canvas rows in
 * aaelink.canvases, and this route reads/writes that one store through the Stage A
 * access engine. A "conversation canvas" is simply the channel_canvas attached to
 * a channel.
 *
 * GET  /api/conversations/canvases?channel_id=... — the channel's canvas (latest)
 * POST /api/conversations/canvases — create the channel's canvas (idempotent-ish:
 *        returns the existing one if present unless force_new is set)
 *
 * Response shape: had no in-repo consumers (grep of components/ found none), so it
 * is aligned to the docs/canvas shape — `{ canvas: { id, title, channel_id,
 * content_blocks, ... } | null }` for GET, `{ ok, canvas_id }` for POST — while
 * keeping the channel-scoped, Slack-style addressing. Access is channel-membership
 * based (private-channel canvases no longer leak).
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const channelId = req.nextUrl.searchParams.get('channel_id') || ''
  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  // Only a channel reader may see the channel's canvas.
  if (!(await userCanReadChannel(pool, uid, channelId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { rows } = await pool.query(
    `SELECT c.id, c.title, c.type, c.channel_id, c.icon, c.content_blocks,
            c.word_count, c.block_count, c.created_by, u.username AS author,
            c.created_at, c.updated_at
       FROM aaelink.canvases c
       LEFT JOIN aaelink.users u ON u.id = c.created_by
      WHERE c.channel_id = $1 AND c.type = 'channel_canvas' AND c.deleted_at = 0
      ORDER BY c.updated_at DESC, c.created_at DESC
      LIMIT 1`,
    [channelId]
  )

  const c = rows[0]
  if (!c) return NextResponse.json({ canvas: null })
  return NextResponse.json({
    canvas: {
      ...c,
      content_blocks:
        typeof c.content_blocks === 'string'
          ? JSON.parse(c.content_blocks || '[]')
          : (c.content_blocks ?? []),
      created_at: Number(c.created_at),
      updated_at: Number(c.updated_at || 0),
    },
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
    channel_id?: string
    title?: string
    force_new?: boolean
  }

  if (!body.channel_id) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  // Creating/attaching a channel canvas requires the ability to read the channel,
  // exactly like /api/docs/canvas POST for channel_canvas.
  if (!(await userCanReadChannel(pool, uid, body.channel_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Return the existing canvas unless the caller explicitly wants a fresh one.
  if (!body.force_new) {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM aaelink.canvases
        WHERE channel_id = $1 AND type = 'channel_canvas' AND deleted_at = 0
        ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
      [body.channel_id]
    )
    if (rows[0]) return NextResponse.json({ ok: true, canvas_id: rows[0].id, existing: true })
  }

  const id = randomUUID()
  const now = Date.now()
  const title = String(body.title || 'Conversation Canvas').trim()
  const blocks = [{ type: 'paragraph', content: '' }]
  const workspaceId = await resolveCanvasWorkspace(pool, uid, { type: 'channel_canvas', channelId: body.channel_id })

  await pool.query(
    `INSERT INTO aaelink.canvases
       (id, title, type, channel_id, workspace_id, icon, cover_image,
        content_blocks, word_count, block_count,
        shared_with, is_pinned, is_template,
        created_by, last_edited_by, created_at, updated_at)
     VALUES ($1, $2, 'channel_canvas', $3, $4, '📄', '',
             $5::jsonb, 0, 1, '[]'::jsonb, false, false,
             $6, $6, $7, $7)`,
    [id, title, body.channel_id, workspaceId, JSON.stringify(blocks), uid, now]
  )

  writeAuditLog({
    pool, actorId: uid, action: 'canvas.create', resourceKind: 'canvas', resourceId: id,
    ipAddress: extractIp(req), metadata: { type: 'channel_canvas', channel_id: body.channel_id, via: 'conversations.canvases' },
  })

  await emitKnowledgeEvent(
    { kind: 'canvas.updated', canvas_id: id, channel_id: body.channel_id, updated_at: now },
    { channelId: body.channel_id }
  )

  return NextResponse.json({ ok: true, canvas_id: id }, { status: 201 })
}

export const GET  = tracedRoute('GET',  '/api/conversations/canvases', _GET)
export const POST = tracedRoute('POST', '/api/conversations/canvases', _POST)
