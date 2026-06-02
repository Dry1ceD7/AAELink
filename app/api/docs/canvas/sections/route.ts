// keep: slack-compat surface (intentionally addressable, may be invoked by Slack-shaped clients)
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Canvas Sections API — Slack canvases.sections parity.
 *
 * GET  /api/docs/canvas/sections?canvas_id=...  — list sections
 * POST /api/docs/canvas/sections — create/update/delete/reorder sections
 *   Actions: create, update, delete, reorder
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const canvasId = req.nextUrl.searchParams.get('canvas_id') || ''
  if (!canvasId) return NextResponse.json({ error: 'canvas_id_required' }, { status: 400 })

  await ensureSectionsTable(pool)

  const { rows } = await pool.query(
    `SELECT id, canvas_id, section_type, title, content, position, created_by, created_at, updated_at
     FROM aaelink.canvas_sections
     WHERE canvas_id = $1
     ORDER BY position ASC, created_at ASC`,
    [canvasId]
  )

  return NextResponse.json({ sections: rows })
}

async function _POST(req: NextRequest) {
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
  }

  const { action, canvas_id } = body
  if (!canvas_id) return NextResponse.json({ error: 'canvas_id_required' }, { status: 400 })

  await ensureSectionsTable(pool)
  const now = Date.now()

  if (action === 'create') {
    const id = randomUUID()
    const maxPos = await pool.query<{ max: number }>(
      `SELECT COALESCE(MAX(position), -1) AS max FROM aaelink.canvas_sections WHERE canvas_id = $1`,
      [canvas_id]
    )
    const position = body.position ?? ((maxPos.rows[0]?.max ?? -1) + 1)

    await pool.query(
      `INSERT INTO aaelink.canvas_sections (id, canvas_id, section_type, title, content, position, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
      [id, canvas_id, body.section_type || 'text', body.title || '', body.content || '', position, uid, now]
    )
    return NextResponse.json({ ok: true, section_id: id })
  }

  if (action === 'update') {
    if (!body.section_id) return NextResponse.json({ error: 'section_id_required' }, { status: 400 })
    const sets: string[] = []
    const params: unknown[] = [body.section_id, canvas_id]

    if (body.title !== undefined) { params.push(body.title); sets.push(`title = $${params.length}`) }
    if (body.content !== undefined) { params.push(body.content); sets.push(`content = $${params.length}`) }
    if (body.section_type !== undefined) { params.push(body.section_type); sets.push(`section_type = $${params.length}`) }
    params.push(now); sets.push(`updated_at = $${params.length}`)

    if (sets.length > 0) {
      await pool.query(
        `UPDATE aaelink.canvas_sections SET ${sets.join(', ')} WHERE id = $1 AND canvas_id = $2`,
        params
      )
    }
    return NextResponse.json({ ok: true })
  }

  if (action === 'delete') {
    if (!body.section_id) return NextResponse.json({ error: 'section_id_required' }, { status: 400 })
    await pool.query(
      `DELETE FROM aaelink.canvas_sections WHERE id = $1 AND canvas_id = $2`,
      [body.section_id, canvas_id]
    )
    return NextResponse.json({ ok: true })
  }

  if (action === 'reorder') {
    const order = body.sections_order || []
    for (let i = 0; i < order.length; i++) {
      await pool.query(
        `UPDATE aaelink.canvas_sections SET position = $1, updated_at = $2 WHERE id = $3 AND canvas_id = $4`,
        [i, now, order[i], canvas_id]
      )
    }
    return NextResponse.json({ ok: true, reordered: order.length })
  }

  return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
}

async function ensureSectionsTable(pool: import('pg').Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.canvas_sections (
      id            TEXT PRIMARY KEY,
      canvas_id     TEXT NOT NULL,
      section_type  TEXT NOT NULL DEFAULT 'text',
      title         TEXT NOT NULL DEFAULT '',
      content       TEXT NOT NULL DEFAULT '',
      position      INT NOT NULL DEFAULT 0,
      created_by    TEXT,
      created_at    BIGINT NOT NULL DEFAULT 0,
      updated_at    BIGINT NOT NULL DEFAULT 0
    )
  `).catch(() => {})
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_canvas_sections_canvas ON aaelink.canvas_sections(canvas_id)`).catch(() => {})
}

export const GET  = tracedRoute('GET',  '/api/docs/canvas/sections', _GET)
export const POST = tracedRoute('POST', '/api/docs/canvas/sections', _POST)
