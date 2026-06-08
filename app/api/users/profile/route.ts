import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { emitUserUpdated } from '@/lib/webhooks/webhookEmitter'

/**
 * User Profile API — Slack users.profile.get/set parity.
 *
 * GET  /api/users/profile — get own or other user's profile
 * PUT  /api/users/profile — update own profile fields
 * POST /api/users/profile — bulk field update (admin)
 *
 * Profile fields: display_name, title, phone, pronouns, timezone, 
 * avatar_url, custom_status, custom_status_emoji, fields (custom).
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const targetId = req.nextUrl.searchParams.get('user_id') || uid

  const { rows } = await pool.query<{
    id: string; email: string; display_name: string; platform_role: string;
    avatar_url: string; department_id: string; created_at: number;
    status_text: string; status_emoji: string
  }>(
    // The users table has no display_name/status/workspace_id columns — derive a
    // display name from nickname > "first last" > username, and alias the
    // free-text department column as department_id for the lookup below. Custom
    // status text/emoji live on users; only expiry lives on user_status.
    `SELECT id, email,
            COALESCE(NULLIF(nickname, ''), NULLIF(TRIM(first_name || ' ' || last_name), ''), username) AS display_name,
            platform_role, avatar_url, COALESCE(department, '') AS department_id, created_at,
            COALESCE(status_text, '') AS status_text, COALESCE(status_emoji, '') AS status_emoji
     FROM aaelink.users WHERE id = $1`, [targetId]
  )
  if (!rows[0]) return NextResponse.json({ error: 'user_not_found' }, { status: 404 })

  const user = rows[0]

  // Get profile metadata
  const { rows: metaRows } = await pool.query<{ key: string; value: string }>(
    `SELECT key, value FROM aaelink.user_preferences WHERE user_id = $1 AND key LIKE 'profile.%'`, [targetId]
  )
  const profile: Record<string, string> = {}
  for (const m of metaRows) profile[m.key.replace('profile.', '')] = m.value

  // Custom-status expiry lives on user_status (text/emoji are on users, above).
  const { rows: statusRows } = await pool.query<{ expires_at: number }>(
    `SELECT expires_at FROM aaelink.user_status WHERE user_id = $1`, [targetId]
  )

  // Get department name
  let department_name = ''
  if (user.department_id) {
    const { rows: deptRows } = await pool.query<{ name: string }>(
      `SELECT name FROM aaelink.departments WHERE id = $1`, [user.department_id]
    )
    department_name = deptRows[0]?.name || ''
  }

  return NextResponse.json({
    profile: {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      real_name: profile.real_name || user.display_name,
      title: profile.title || '',
      phone: profile.phone || '',
      pronouns: profile.pronouns || '',
      timezone: profile.timezone || 'UTC',
      avatar_url: user.avatar_url || '',
      role: user.platform_role,
      department: department_name,
      status_text: user.status_text || '',
      status_emoji: user.status_emoji || '',
      status_expiration: statusRows[0]?.expires_at || 0,
      fields: profile,
      is_bot: false,
      is_admin: ['super_admin', 'platform_admin'].includes(user.platform_role),
      account_status: 'active',
      created_at: user.created_at,
    },
  })
}

async function _PUT(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Record<string, string>
  const now = Date.now()

  // Updatable profile fields
  const allowedFields = ['real_name', 'title', 'phone', 'pronouns', 'timezone', 'skype', 'location']
  // Track which fields actually changed so the user.updated emit below carries an
  // accurate field list and stays a no-op for an empty PUT.
  const changedFields: string[] = []

  // The users table has no display_name column; the editable display name maps
  // to nickname (the field the display-name derivation prefers).
  if (body.display_name) {
    await pool.query(`UPDATE aaelink.users SET nickname = $1 WHERE id = $2`, [body.display_name, uid])
    changedFields.push('display_name')
  }

  // Update avatar_url directly
  if (body.avatar_url) {
    await pool.query(`UPDATE aaelink.users SET avatar_url = $1 WHERE id = $2`, [body.avatar_url, uid])
    changedFields.push('avatar_url')
  }

  // Update profile metadata
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      await pool.query(`
        INSERT INTO aaelink.user_preferences (user_id, key, value, updated_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, key) DO UPDATE SET value = $3, updated_at = $4
      `, [uid, `profile.${field}`, String(body[field]), now])
      changedFields.push(field)
    }
  }

  // Handle custom fields
  if (body.custom_fields) {
    try {
      const customFields = JSON.parse(body.custom_fields) as Record<string, string>
      for (const [k, v] of Object.entries(customFields)) {
        await pool.query(`
          INSERT INTO aaelink.user_preferences (user_id, key, value, updated_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (user_id, key) DO UPDATE SET value = $3, updated_at = $4
        `, [uid, `profile.custom.${k}`, String(v), now])
        changedFields.push(`custom.${k}`)
      }
    } catch { /* ignore malformed */ }
  }

  // Fan out user.updated to subscribed outgoing webhooks + Events-API
  // subscriptions when something actually changed. Best-effort: never block.
  if (changedFields.length > 0) {
    try {
      await emitUserUpdated(pool, { user_id: uid, fields: changedFields, actor_id: uid })
    } catch (e) { console.error('emitUserUpdated', e) }
  }

  return NextResponse.json({ ok: true })
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
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    user_id?: string; fields?: Record<string, string>
  }

  if (!body.user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 })
  const now = Date.now()

  const changedFields: string[] = []
  if (body.fields) {
    for (const [k, v] of Object.entries(body.fields)) {
      await pool.query(`
        INSERT INTO aaelink.user_preferences (user_id, key, value, updated_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, key) DO UPDATE SET value = $3, updated_at = $4
      `, [body.user_id, `profile.${k}`, String(v), now])
      changedFields.push(k)
    }
  }

  // Fan out user.updated for the targeted user (actor = admin) when something
  // changed. Best-effort: never block the admin mutation.
  if (changedFields.length > 0) {
    try {
      await emitUserUpdated(pool, { user_id: body.user_id, fields: changedFields, actor_id: uid })
    } catch (e) { console.error('emitUserUpdated', e) }
  }

  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/users/profile', _GET)
export const POST   = tracedRoute('POST', '/api/users/profile', _POST)
export const PUT    = tracedRoute('PUT', '/api/users/profile', _PUT)
