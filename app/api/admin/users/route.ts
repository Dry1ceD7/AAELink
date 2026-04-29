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
    `SELECT id, username, email, first_name, last_name, platform_role, created_at
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
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === '23505') {
      return NextResponse.json({ error: 'username_or_email_taken' }, { status: 409 })
    }
    return NextResponse.json({ error: 'create_failed' }, { status: 400 })
  }
  return NextResponse.json({ user: { id, username, email, first_name, last_name, platform_role } })
}
