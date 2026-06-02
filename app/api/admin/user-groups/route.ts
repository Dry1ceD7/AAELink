import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * GET /api/admin/user-groups — list user groups.
 * POST /api/admin/user-groups — create a user group.
 * PATCH /api/admin/user-groups — update a user group.
 * DELETE /api/admin/user-groups?id= — delete a user group.
 *
 * Stored in `aaelink.user_groups` + `aaelink.user_group_members`.
 */

const GROUPS_DDL = `
  CREATE TABLE IF NOT EXISTS aaelink.user_groups (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    handle      TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    enabled     BOOLEAN NOT NULL DEFAULT true,
    created_by  UUID REFERENCES aaelink.users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS aaelink.user_group_members (
    group_id  UUID NOT NULL REFERENCES aaelink.user_groups(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
    added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_ugm_group ON aaelink.user_group_members(group_id);
  CREATE INDEX IF NOT EXISTS idx_ugm_user  ON aaelink.user_group_members(user_id);
`

async function ensureGroups(pool: ReturnType<typeof getPool>) {
  if (!pool) return
  await pool.query(GROUPS_DDL)
}

async function _GET(_req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  await ensureGroups(pool)

  const { rows } = await pool.query(
    `SELECT g.*,
            (SELECT COUNT(*)::int FROM aaelink.user_group_members m WHERE m.group_id = g.id) AS member_count,
            u.username AS created_by_username
     FROM aaelink.user_groups g
     LEFT JOIN aaelink.users u ON u.id = g.created_by
     ORDER BY g.name`
  )

  return NextResponse.json({ groups: rows })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  await ensureGroups(pool)

  const body = await req.json()
  const { handle, name, description, members } = body as {
    handle: string; name: string; description?: string; members?: string[]
  }

  if (!handle?.trim() || !name?.trim()) {
    return NextResponse.json({ error: 'handle and name are required' }, { status: 400 })
  }

  const cleanHandle = handle.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_-]/g, '')

  const { rows } = await pool.query(
    `INSERT INTO aaelink.user_groups (handle, name, description, created_by)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [cleanHandle, name.trim(), description?.trim() || '', uid]
  )

  // Add members if provided
  if (members && members.length > 0) {
    const values = members.map((_, i) => `($1, $${i + 2}::uuid)`).join(', ')
    await pool.query(
      `INSERT INTO aaelink.user_group_members (group_id, user_id) VALUES ${values} ON CONFLICT DO NOTHING`,
      [rows[0].id, ...members]
    ).catch(() => {})
  }

  return NextResponse.json({ group: rows[0] }, { status: 201 })
}

async function _PATCH(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  await ensureGroups(pool)

  const body = await req.json()
  const { id, name, description, enabled } = body as {
    id: string; name?: string; description?: string; enabled?: boolean
  }

  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const sets: string[] = ['updated_at = now()']
  const params: (string | boolean)[] = [id]

  if (name !== undefined) { params.push(name); sets.push(`name = $${params.length}`) }
  if (description !== undefined) { params.push(description); sets.push(`description = $${params.length}`) }
  if (enabled !== undefined) { params.push(enabled); sets.push(`enabled = $${params.length}`) }

  const { rows } = await pool.query(
    `UPDATE aaelink.user_groups SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params
  )

  return NextResponse.json({ group: rows[0] })
}

async function _DELETE(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  const role = (uRows[0] as { platform_role?: string })?.platform_role || ''
  if (!isPlatformAdmin(role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  await ensureGroups(pool)

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  await pool.query(`DELETE FROM aaelink.user_groups WHERE id = $1`, [id])

  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/user-groups', _GET)
export const POST   = tracedRoute('POST', '/api/admin/user-groups', _POST)
export const PATCH  = tracedRoute('PATCH', '/api/admin/user-groups', _PATCH)
export const DELETE = tracedRoute('DELETE', '/api/admin/user-groups', _DELETE)
