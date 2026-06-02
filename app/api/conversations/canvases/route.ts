import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Conversations Canvases API — Slack conversations.canvases parity.
 *
 * GET  /api/conversations/canvases?channel_id=... — get canvas linked to conversation
 * POST /api/conversations/canvases — create/link canvas to conversation
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const channelId = req.nextUrl.searchParams.get('channel_id') || ''
  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  await ensureConversationCanvasTable(pool)

  const { rows } = await pool.query(
    `SELECT cc.canvas_id, cc.linked_at, cc.linked_by,
            d.title AS canvas_title, d.body AS canvas_content, d.created_at AS canvas_created_at
     FROM aaelink.conversation_canvases cc
     LEFT JOIN aaelink.documents d ON d.id = cc.canvas_id
     WHERE cc.channel_id = $1
     ORDER BY cc.linked_at DESC LIMIT 1`,
    [channelId]
  )

  if (!rows[0]) return NextResponse.json({ canvas: null })
  return NextResponse.json({ canvas: rows[0] })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    channel_id?: string
    canvas_id?: string
    title?: string
  }

  if (!body.channel_id) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  await ensureConversationCanvasTable(pool)
  const now = Date.now()

  let canvasId = body.canvas_id

  // If no canvas_id, create a new canvas document
  if (!canvasId) {
    canvasId = randomUUID()
    await pool.query(
      `INSERT INTO aaelink.documents (id, title, body, doc_type, created_by, created_at, updated_at)
       VALUES ($1, $2, '', 'canvas', $3, $4, $4)
       ON CONFLICT DO NOTHING`,
      [canvasId, body.title || `Canvas for conversation`, uid, now]
    )
  }

  // Link canvas to conversation
  await pool.query(
    `INSERT INTO aaelink.conversation_canvases (id, channel_id, canvas_id, linked_by, linked_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (channel_id) DO UPDATE SET canvas_id = $3, linked_by = $4, linked_at = $5`,
    [randomUUID(), body.channel_id, canvasId, uid, now]
  )

  return NextResponse.json({ ok: true, canvas_id: canvasId })
}

async function ensureConversationCanvasTable(pool: import('pg').Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.conversation_canvases (
      id          TEXT PRIMARY KEY,
      channel_id  TEXT NOT NULL UNIQUE,
      canvas_id   TEXT NOT NULL,
      linked_by   TEXT,
      linked_at   BIGINT NOT NULL DEFAULT 0
    )
  `).catch(() => {})
}

export const GET  = tracedRoute('GET',  '/api/conversations/canvases', _GET)
export const POST = tracedRoute('POST', '/api/conversations/canvases', _POST)
