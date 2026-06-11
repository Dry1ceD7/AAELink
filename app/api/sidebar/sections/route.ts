// keep: slack-compat surface (intentionally addressable, may be invoked by Slack-shaped clients)
import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Sidebar Sections / Channel Categories (Slack "Custom sections").
 *
 * Users can organize their sidebar into named sections:
 *   "Work", "Projects", "Social", "Clients", etc.
 *
 * GET    /api/sidebar/sections?workspace_id=...     — list user's sections
 * POST   /api/sidebar/sections                      — create a section
 * PUT    /api/sidebar/sections                      — reorder sections
 * PATCH  /api/sidebar/sections                      — rename or update a section
 * DELETE /api/sidebar/sections { section_id }       — delete a section
 * POST   /api/sidebar/sections/channels             — add/remove channels from a section
 */

/** GET — list sidebar sections with channel assignments */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const workspaceId = req.nextUrl.searchParams.get('workspace_id')?.trim() || ''
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })

  // Get sections
  const { rows: sections } = await pool.query<{
    id: string; name: string; emoji: string; sort_order: number; is_collapsed: boolean
  }>(
    `SELECT id, name, emoji, sort_order, is_collapsed
     FROM aaelink.sidebar_sections
     WHERE user_id = $1 AND workspace_id = $2
     ORDER BY sort_order ASC`,
    [uid, workspaceId]
  )

  // Get channel assignments for all sections
  const sectionIds = sections.map(s => s.id)
  let channelMap: Record<string, { channel_id: string; sort_order: number }[]> = {}

  if (sectionIds.length > 0) {
    const { rows: assignments } = await pool.query<{
      section_id: string; channel_id: string; sort_order: number
    }>(
      `SELECT section_id, channel_id, sort_order
       FROM aaelink.sidebar_section_channels
       WHERE section_id = ANY($1)
       ORDER BY sort_order ASC`,
      [sectionIds]
    )

    channelMap = {}
    for (const a of assignments) {
      if (!channelMap[a.section_id]) channelMap[a.section_id] = []
      channelMap[a.section_id].push({ channel_id: a.channel_id, sort_order: a.sort_order })
    }
  }

  return NextResponse.json({
    sections: sections.map(s => ({
      ...s,
      channels: channelMap[s.id] || []
    }))
  })
}

/** POST — create a new sidebar section */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    workspace_id?: string
    name?: string
    emoji?: string
    channel_ids?: string[]
  }

  const workspaceId = String(body.workspace_id || '').trim()
  const name = String(body.name || '').trim()
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  if (!name || name.length > 64) return NextResponse.json({ error: 'invalid_name' }, { status: 400 })

  // Get next sort order
  const { rows: maxOrder } = await pool.query<{ max: number }>(
    `SELECT COALESCE(MAX(sort_order), 0) AS max FROM aaelink.sidebar_sections WHERE user_id = $1 AND workspace_id = $2`,
    [uid, workspaceId]
  )

  const id = randomUUID()
  const sortOrder = (maxOrder[0]?.max || 0) + 1

  await pool.query(
    `INSERT INTO aaelink.sidebar_sections (id, user_id, workspace_id, name, emoji, sort_order, is_collapsed)
     VALUES ($1, $2, $3, $4, $5, $6, false)`,
    [id, uid, workspaceId, name, body.emoji || '', sortOrder]
  )

  // Add initial channels if provided
  if (Array.isArray(body.channel_ids)) {
    for (let i = 0; i < body.channel_ids.length; i++) {
      await pool.query(
        `INSERT INTO aaelink.sidebar_section_channels (section_id, channel_id, sort_order)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [id, body.channel_ids[i], i + 1]
      )
    }
  }

  return NextResponse.json({
    section: { id, name, emoji: body.emoji || '', sort_order: sortOrder, is_collapsed: false }
  })
}

/** PUT — reorder sections */
async function _PUT(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    section_ids?: string[]
  }

  if (!Array.isArray(body.section_ids) || body.section_ids.length === 0) {
    return NextResponse.json({ error: 'section_ids_required' }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (let i = 0; i < body.section_ids.length; i++) {
      await client.query(
        `UPDATE aaelink.sidebar_sections SET sort_order = $1 WHERE id = $2 AND user_id = $3`,
        [i + 1, body.section_ids[i], uid]
      )
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }

  return NextResponse.json({ ok: true })
}

/** PATCH — rename, toggle collapse, or update emoji */
async function _PATCH(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    section_id?: string
    name?: string
    emoji?: string
    is_collapsed?: boolean
    // Add/remove channels
    add_channel_ids?: string[]
    remove_channel_ids?: string[]
  }

  const sectionId = String(body.section_id || '').trim()
  if (!sectionId) return NextResponse.json({ error: 'section_id_required' }, { status: 400 })

  // Update section properties
  const sets: string[] = []
  const params: (string | boolean)[] = [sectionId, uid]

  if (body.name !== undefined) {
    params.push(body.name.trim())
    sets.push(`name = $${params.length}`)
  }
  if (body.emoji !== undefined) {
    params.push(body.emoji)
    sets.push(`emoji = $${params.length}`)
  }
  if (body.is_collapsed !== undefined) {
    params.push(body.is_collapsed)
    sets.push(`is_collapsed = $${params.length}`)
  }

  if (sets.length > 0) {
    await pool.query(
      `UPDATE aaelink.sidebar_sections SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2`,
      params
    )
  }

  // Add channels
  if (Array.isArray(body.add_channel_ids)) {
    for (const cid of body.add_channel_ids) {
      await pool.query(
        `INSERT INTO aaelink.sidebar_section_channels (section_id, channel_id, sort_order)
         VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM aaelink.sidebar_section_channels WHERE section_id = $1))
         ON CONFLICT DO NOTHING`,
        [sectionId, cid]
      )
    }
  }

  // Remove channels
  if (Array.isArray(body.remove_channel_ids)) {
    for (const cid of body.remove_channel_ids) {
      await pool.query(
        `DELETE FROM aaelink.sidebar_section_channels WHERE section_id = $1 AND channel_id = $2`,
        [sectionId, cid]
      )
    }
  }

  return NextResponse.json({ ok: true })
}

/** DELETE — remove a sidebar section */
async function _DELETE(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { section_id?: string }
  const sectionId = String(body.section_id || '').trim()
  if (!sectionId) return NextResponse.json({ error: 'section_id_required' }, { status: 400 })

  // Cascade: channel assignments are removed via FK ON DELETE CASCADE
  await pool.query(
    `DELETE FROM aaelink.sidebar_sections WHERE id = $1 AND user_id = $2`,
    [sectionId, uid]
  )

  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/sidebar/sections', _GET)
export const POST   = tracedRoute('POST', '/api/sidebar/sections', _POST)
export const PUT    = tracedRoute('PUT', '/api/sidebar/sections', _PUT)
export const PATCH  = tracedRoute('PATCH', '/api/sidebar/sections', _PATCH)
export const DELETE = tracedRoute('DELETE', '/api/sidebar/sections', _DELETE)
