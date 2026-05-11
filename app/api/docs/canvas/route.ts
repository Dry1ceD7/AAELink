import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Canvas / Collaborative Documents API — freeform structured docs within channels.
 *
 * GET  /api/docs/canvas — list canvases (global, channel, or personal)
 * POST /api/docs/canvas — create a new canvas
 * PUT  /api/docs/canvas — update canvas content
 *
 * Canvas types:
 *   - channel_canvas — embedded in a channel, visible to all members
 *   - personal_note  — private to the creator
 *   - shared_doc     — shared with specific users/channels
 *   - template       — reusable starting points
 *
 * Content model:
 *   Block-based JSON structure (similar to Notion/Slack Canvas):
 *   - paragraph, heading, code, image, divider, checklist, table, embed
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

  let where = 'WHERE 1=1'
  const params: string[] = []

  if (channelId) { params.push(channelId); where += ` AND c.channel_id = $${params.length}` }
  if (mine) { params.push(uid); where += ` AND c.created_by = $${params.length}` }
  if (['channel_canvas', 'personal_note', 'shared_doc', 'template'].includes(type)) {
    params.push(type); where += ` AND c.type = $${params.length}`
  }

  // For non-personal canvases, ensure user has access
  if (!mine) {
    where += ` AND (c.created_by = '${uid}' OR c.type = 'channel_canvas' OR c.type = 'template'
                OR c.shared_with @> '"${uid}"'::jsonb)`
  }

  const { rows } = await pool.query(`
    SELECT c.id, c.title, c.type, c.channel_id, c.icon, c.cover_image,
           c.is_pinned, c.is_template,
           c.word_count, c.block_count,
           c.created_by, u.username AS author, c.created_at, c.updated_at,
           c.last_edited_by, u2.username AS last_editor
    FROM aaelink.canvases c
    LEFT JOIN aaelink.users u ON u.id = c.created_by
    LEFT JOIN aaelink.users u2 ON u2.id = c.last_edited_by
    ${where}
    ORDER BY c.updated_at DESC
    LIMIT 100
  `, params)

  return NextResponse.json({
    canvases: rows.map(c => ({ ...c, created_at: Number(c.created_at), updated_at: Number(c.updated_at || 0) })),
    total: rows.length,
  })
}

async function _POST(req: NextRequest) {
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
  }

  const title = String(body.title || 'Untitled Canvas').trim()
  const VALID_TYPES = ['channel_canvas', 'personal_note', 'shared_doc', 'template']
  const type = VALID_TYPES.includes(body.type || '') ? body.type! : 'personal_note'

  const blocks = Array.isArray(body.content_blocks) ? body.content_blocks : [
    { type: 'paragraph', content: '' }
  ]

  // Calculate word/block counts
  const wordCount = blocks.reduce((sum, b) => sum + (String(b.content || '').split(/\s+/).filter(Boolean).length), 0)

  const id = randomUUID()
  const now = Date.now()

  await pool.query(`
    INSERT INTO aaelink.canvases
      (id, title, type, channel_id, icon, cover_image,
       content_blocks, word_count, block_count,
       shared_with, is_pinned, is_template,
       created_by, last_edited_by, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, $11, $12, $12, $13, $13)
  `, [
    id, title, type, body.channel_id || null,
    body.icon || '📄', body.cover_image || '',
    JSON.stringify(blocks), wordCount, blocks.length,
    JSON.stringify(body.shared_with || []), body.is_template || false,
    uid, now
  ])

  return NextResponse.json({
    canvas: { id, title, type, block_count: blocks.length, word_count: wordCount, created_at: now }
  }, { status: 201 })
}

async function _PUT(req: NextRequest) {
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

  const updates: string[] = []
  const params: unknown[] = []

  if (body.title) { params.push(body.title); updates.push(`title = $${params.length}`) }
  if (body.icon) { params.push(body.icon); updates.push(`icon = $${params.length}`) }
  if (body.cover_image !== undefined) { params.push(body.cover_image); updates.push(`cover_image = $${params.length}`) }
  if (body.is_pinned !== undefined) { params.push(body.is_pinned); updates.push(`is_pinned = $${params.length}`) }
  if (body.shared_with) { params.push(JSON.stringify(body.shared_with)); updates.push(`shared_with = $${params.length}`) }

  if (body.content_blocks) {
    const blocks = body.content_blocks
    const wordCount = blocks.reduce((sum, b) => sum + (String(b.content || '').split(/\s+/).filter(Boolean).length), 0)
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
    `UPDATE aaelink.canvases SET ${updates.join(', ')} WHERE id = $${params.length}`,
    params
  )
  if (!rowCount) return NextResponse.json({ error: 'canvas_not_found' }, { status: 404 })

  return NextResponse.json({ ok: true, updated_at: now })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/docs/canvas', _GET)
export const POST   = tracedRoute('POST', '/api/docs/canvas', _POST)
export const PUT    = tracedRoute('PUT', '/api/docs/canvas', _PUT)
