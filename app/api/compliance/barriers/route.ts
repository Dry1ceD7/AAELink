import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Information Barriers API — restrict communication between user groups.
 *
 * GET  /api/compliance/barriers — list information barrier policies
 * POST /api/compliance/barriers — create a new barrier
 *
 * Barrier types:
 *   - department: block inter-department communication
 *   - group: block communication between specific user groups
 *   - custom: arbitrary user sets
 *
 * When a barrier is active between two groups:
 *   - Members cannot DM each other
 *   - Members cannot be in the same channel
 *   - Members cannot see each other in user search
 *   - File sharing is blocked between groups
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { rows } = await pool.query(`
    SELECT b.*, u.username AS created_by_username
    FROM aaelink.information_barriers b
    LEFT JOIN aaelink.users u ON u.id = b.created_by
    ORDER BY b.created_at DESC
    LIMIT 100
  `)

  return NextResponse.json({
    barriers: rows.map(b => ({ ...b, created_at: Number(b.created_at) })),
    total: rows.length,
  })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (uRows[0]?.platform_role !== 'super_admin') {
    return NextResponse.json({ error: 'super_admin_only' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: string; type?: string; description?: string
    group_a_ids?: string[]; group_b_ids?: string[]
    block_dm?: boolean; block_channels?: boolean
    block_search?: boolean; block_file_share?: boolean
  }

  const name = String(body.name || '').trim()
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })

  const groupA = Array.isArray(body.group_a_ids) ? body.group_a_ids : []
  const groupB = Array.isArray(body.group_b_ids) ? body.group_b_ids : []
  if (groupA.length === 0 || groupB.length === 0) {
    return NextResponse.json({ error: 'both_group_a_and_group_b_required' }, { status: 400 })
  }

  const id = randomUUID()
  const now = Date.now()
  const barrierType = ['department', 'group', 'custom'].includes(body.type || '') ? body.type! : 'custom'

  await pool.query(`
    INSERT INTO aaelink.information_barriers
      (id, name, type, description, group_a_ids, group_b_ids,
       block_dm, block_channels, block_search, block_file_share,
       is_active, created_by, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11, $12)
  `, [
    id, name, barrierType, body.description || '',
    JSON.stringify(groupA), JSON.stringify(groupB),
    body.block_dm !== false, body.block_channels !== false,
    body.block_search !== false, body.block_file_share !== false,
    uid, now
  ])

  await pool.query(`
    INSERT INTO aaelink.audit_log (id, actor_id, action, target_type, target_id, meta, created_at)
    VALUES ($1, $2, 'barrier_created', 'information_barrier', $3, $4, $5)
  `, [randomUUID(), uid, id, JSON.stringify({ name, group_a: groupA.length, group_b: groupB.length }), now])

  return NextResponse.json({
    barrier: { id, name, type: barrierType, is_active: true, created_at: now }
  }, { status: 201 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/compliance/barriers', _GET)
export const POST   = tracedRoute('POST', '/api/compliance/barriers', _POST)
