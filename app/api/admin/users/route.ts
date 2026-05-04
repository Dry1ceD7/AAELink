import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { getAdminSession } from '@/lib/adminAuth'
import { hashPassword } from '@/lib/password'
import { isItAdmin, isSuperAdmin } from '@/lib/platformRole'
import { AAELINK_GLOBAL_WORKSPACE_ID } from '@/lib/constants'

const ALLOWED_ROLES = new Set(['', 'employee', 'it_employee', 'it_admin'])

export async function GET() {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const adm = await getAdminSession(pool)
  if (!adm) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { rows } = await pool.query(
    `SELECT id, username, email, first_name, last_name, platform_role, created_at, avatar_url, job_title, phone, timezone, status_text, status_emoji
     FROM aaelink.users ORDER BY created_at DESC LIMIT 500`
  )
  return NextResponse.json({ users: rows })
}

export async function POST(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const adm = await getAdminSession(pool)
  if (!adm) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const body = (await req.json()) as {
    username?: string
    email?: string
    password?: string
    first_name?: string
    last_name?: string
    platform_role?: string
  }
  const username = String(body.username || '').trim()
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  const first_name = String(body.first_name || '').trim()
  const last_name = String(body.last_name || '').trim()
  let platform_role = String(body.platform_role ?? '').trim()
  if (!ALLOWED_ROLES.has(platform_role)) platform_role = 'employee'
  if (platform_role === 'it_admin' && !isSuperAdmin(adm.platformRole)) {
    return NextResponse.json({ error: 'forbidden_role' }, { status: 403 })
  }
  if (isItAdmin(adm.platformRole) && platform_role !== 'employee' && platform_role !== 'it_employee') {
    return NextResponse.json({ error: 'forbidden_role' }, { status: 403 })
  }
  const roleToStore =
    platform_role === 'it_admin' || platform_role === 'it_employee' ? platform_role : 'employee'
  if (username.length < 2 || !email.includes('@') || password.length < 8) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  }
  const id = randomUUID()
  const now = Date.now()
  const password_hash = hashPassword(password)
  try {
    await pool.query(
      `INSERT INTO aaelink.users (id, username, email, password_hash, first_name, last_name, nickname, created_at, last_seen_at, platform_role)
       VALUES ($1, $2, $3, $4, $5, $6, '', $7, 0, $8)`,
      [id, username, email, password_hash, first_name, last_name, now, roleToStore]
    )
    await pool.query(
      `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')
       ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      [AAELINK_GLOBAL_WORKSPACE_ID, id]
    )
    const ipAddress = req.headers.get('x-forwarded-for') || '127.0.0.1'
    const userAgent = req.headers.get('user-agent') || ''
    await pool.query(`
      INSERT INTO aaelink.audit_log (id, actor_id, actor_role, action, resource_kind, resource_id, ip_address, user_agent, metadata, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      randomUUID(), adm.userId, adm.platformRole, 'admin_create_user', 'user', id,
      ipAddress, userAgent, JSON.stringify({ username, email, platform_role }), now
    ])
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === '23505') {
      return NextResponse.json({ error: 'username_or_email_taken' }, { status: 409 })
    }
    return NextResponse.json({ error: 'create_failed' }, { status: 400 })
  }
  return NextResponse.json({ user: { id, username, email, first_name, last_name, platform_role } })
}

/** PATCH /api/admin/users — update user role / profile (admin only). */
export async function PATCH(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const adm = await getAdminSession(pool)
  if (!adm) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as {
    user_id?: string
    platform_role?: string
    first_name?: string
    last_name?: string
    department_id?: string
  }

  const userId = String(body.user_id || '').trim()
  if (!userId) return NextResponse.json({ error: 'user_id_required' }, { status: 400 })

  // Prevent editing yourself (for role changes)
  const VALID_ROLES = ['employee', 'it_employee', 'it_support', 'it_admin', 'super_admin']

  const sets: string[] = []
  const vals: unknown[] = []
  let i = 1

  if (typeof body.platform_role === 'string') {
    const role = body.platform_role.trim()
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: 'invalid_role' }, { status: 400 })
    }
    // Only superadmin can set super_admin or it_admin
    if ((role === 'super_admin' || role === 'it_admin') && !isSuperAdmin(adm.platformRole)) {
      return NextResponse.json({ error: 'forbidden_role' }, { status: 403 })
    }
    // IT admin can only set employee/it_employee/it_support
    if (isItAdmin(adm.platformRole) && !isSuperAdmin(adm.platformRole)) {
      if (!['employee', 'it_employee', 'it_support'].includes(role)) {
        return NextResponse.json({ error: 'forbidden_role' }, { status: 403 })
      }
    }
    // Prevent superadmin from demoting themselves
    if (userId === adm.userId && isSuperAdmin(adm.platformRole) && role !== 'super_admin') {
      return NextResponse.json({ error: 'cannot_demote_self' }, { status: 400 })
    }
    sets.push(`platform_role = $${i++}`)
    vals.push(role)
  }

  if (typeof body.first_name === 'string') {
    sets.push(`first_name = $${i++}`)
    vals.push(body.first_name.trim().slice(0, 128))
  }
  if (typeof body.last_name === 'string') {
    sets.push(`last_name = $${i++}`)
    vals.push(body.last_name.trim().slice(0, 128))
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: 'no_fields' }, { status: 400 })
  }

  vals.push(userId)
  await pool.query(`UPDATE aaelink.users SET ${sets.join(', ')} WHERE id = $${i}`, vals)

  // Update workspace member department if provided
  if (typeof body.department_id === 'string') {
    await pool.query(
      `UPDATE aaelink.workspace_members SET department_id = $1 WHERE user_id = $2 AND workspace_id = $3`,
      [body.department_id || null, userId, AAELINK_GLOBAL_WORKSPACE_ID]
    )
  }

  const ipAddress = req.headers.get('x-forwarded-for') || '127.0.0.1'
  const userAgent = req.headers.get('user-agent') || ''
  await pool.query(`
    INSERT INTO aaelink.audit_log (id, actor_id, actor_role, action, resource_kind, resource_id, ip_address, user_agent, metadata, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [
    randomUUID(), adm.userId, adm.platformRole, 'admin_update_user', 'user', userId,
    ipAddress, userAgent, JSON.stringify(body), Date.now()
  ])

  const { rows } = await pool.query(
    `SELECT id, username, email, first_name, last_name, platform_role, created_at, avatar_url, job_title, phone, timezone, status_text, status_emoji FROM aaelink.users WHERE id = $1`,
    [userId]
  )
  return NextResponse.json({ user: rows[0] || null })
}
