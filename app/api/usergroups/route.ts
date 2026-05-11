import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Usergroups API — Slack usergroups.* parity.
 *
 * GET  /api/usergroups — list user groups with members
 * POST /api/usergroups — create/update/disable/enable groups + member management
 *
 * Covers:
 *   - usergroups.create / update / disable / enable / list
 *   - usergroups.users.list / usergroups.users.update
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const groupId = req.nextUrl.searchParams.get('usergroup_id') || ''
  const includeDisabled = req.nextUrl.searchParams.get('include_disabled') === 'true'
  const includeUsers = req.nextUrl.searchParams.get('include_users') !== 'false'

  if (groupId) {
    const { rows } = await pool.query<{
      id: string; name: string; handle: string; description: string;
      created_by: string; created_at: number; is_active: boolean;
    }>(`SELECT * FROM aaelink.user_groups WHERE id = $1`, [groupId])
    if (!rows[0]) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const group = rows[0]
    let users: string[] = []
    if (includeUsers) {
      const { rows: memberRows } = await pool.query<{ user_id: string }>(
        `SELECT user_id FROM aaelink.user_group_members WHERE group_id = $1`, [groupId]
      )
      users = memberRows.map(r => r.user_id)
    }

    return NextResponse.json({
      usergroup: {
        id: group.id,
        name: group.name,
        handle: group.handle || String(group.name || '').toLowerCase().replace(/\s+/g, '-'),
        description: group.description || '',
        is_external: false,
        date_create: group.created_at,
        created_by: group.created_by || '',
        is_usergroup: true,
        auto_type: null,
        users,
        user_count: users.length,
      },
    })
  }

  let query = `SELECT * FROM aaelink.user_groups WHERE 1=1`
  if (!includeDisabled) {
    query += ` AND COALESCE(is_active, true) = true`
  }
  query += ` ORDER BY name ASC`

  const { rows } = await pool.query<{
    id: string; name: string; handle: string; description: string;
    created_by: string; created_at: number; is_active: boolean;
  }>(query)
  const usergroups = await Promise.all(rows.map(async r => {
    let users: string[] = []
    if (includeUsers) {
      const { rows: memberRows } = await pool.query<{ user_id: string }>(
        `SELECT user_id FROM aaelink.user_group_members WHERE group_id = $1`, [r.id]
      )
      users = memberRows.map(mr => mr.user_id)
    }

    return {
      id: r.id,
      name: r.name,
      handle: r.handle || String(r.name || '').toLowerCase().replace(/\s+/g, '-'),
      description: r.description || '',
      is_external: false,
      is_usergroup: true,
      user_count: users.length,
      users,
    }
  }))

  return NextResponse.json({ ok: true, usergroups })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    action?: string; usergroup_id?: string
    name?: string; handle?: string; description?: string
    channels?: string[]
    users?: string[]
  }

  const action = body.action || 'create'
  const now = Date.now()

  if (action === 'create') {
    if (!body.name) return NextResponse.json({ error: 'name required' }, { status: 400 })
    const { randomUUID } = await import('crypto')
    const id = randomUUID()
    const handle = body.handle || body.name.toLowerCase().replace(/\s+/g, '-')

    await pool.query(`
      INSERT INTO aaelink.user_groups (id, name, handle, description, created_by, created_at, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, true)
    `, [id, body.name, handle, body.description || '', uid, now])

    return NextResponse.json({ ok: true, usergroup: { id, name: body.name, handle } }, { status: 201 })
  }

  if (action === 'update') {
    if (!body.usergroup_id) return NextResponse.json({ error: 'usergroup_id required' }, { status: 400 })
    const updates: string[] = []
    const params: unknown[] = []
    if (body.name) { params.push(body.name); updates.push(`name = $${params.length}`) }
    if (body.handle) { params.push(body.handle); updates.push(`handle = $${params.length}`) }
    if (body.description !== undefined) { params.push(body.description); updates.push(`description = $${params.length}`) }
    if (updates.length > 0) {
      params.push(body.usergroup_id)
      await pool.query(`UPDATE aaelink.user_groups SET ${updates.join(', ')} WHERE id = $${params.length}`, params)
    }
    return NextResponse.json({ ok: true })
  }

  if (action === 'disable') {
    if (!body.usergroup_id) return NextResponse.json({ error: 'usergroup_id required' }, { status: 400 })
    await pool.query(`UPDATE aaelink.user_groups SET is_active = false WHERE id = $1`, [body.usergroup_id])
    return NextResponse.json({ ok: true })
  }

  if (action === 'enable') {
    if (!body.usergroup_id) return NextResponse.json({ error: 'usergroup_id required' }, { status: 400 })
    await pool.query(`UPDATE aaelink.user_groups SET is_active = true WHERE id = $1`, [body.usergroup_id])
    return NextResponse.json({ ok: true })
  }

  if (action === 'update_users') {
    if (!body.usergroup_id || !body.users) {
      return NextResponse.json({ error: 'usergroup_id and users required' }, { status: 400 })
    }
    // Replace all members
    await pool.query(`DELETE FROM aaelink.user_group_members WHERE group_id = $1`, [body.usergroup_id])
    for (const userId of body.users) {
      await pool.query(`
        INSERT INTO aaelink.user_group_members (group_id, user_id, added_at)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
      `, [body.usergroup_id, userId, now])
    }
    return NextResponse.json({ ok: true, usergroup_id: body.usergroup_id, users: body.users })
  }

  if (action === 'list_users') {
    if (!body.usergroup_id) return NextResponse.json({ error: 'usergroup_id required' }, { status: 400 })
    const { rows } = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM aaelink.user_group_members WHERE group_id = $1`, [body.usergroup_id]
    )
    return NextResponse.json({ ok: true, users: rows.map(r => r.user_id) })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/usergroups', _GET)
export const POST   = tracedRoute('POST', '/api/usergroups', _POST)
