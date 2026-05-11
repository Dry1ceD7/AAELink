import { NextResponse, type NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

async function _GET() {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const { rows } = await pool.query(
    `SELECT id, username, email, first_name, last_name, nickname, platform_role, avatar_url, job_title, phone, timezone, status_text, status_emoji, pronouns, department FROM aaelink.users WHERE id = $1`,
    [uid]
  )
  const user = rows[0]
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({ user })
}

/** PUT /api/auth/me — update own profile fields. */
async function _PUT(req: NextRequest) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  const body = (await req.json().catch(() => ({}))) as {
    first_name?: string
    last_name?: string
    nickname?: string
    avatar_url?: string
    job_title?: string
    phone?: string
    timezone?: string
    status_text?: string
    status_emoji?: string
    pronouns?: string
    department?: string
  }

  const firstName = typeof body.first_name === 'string' ? body.first_name.trim().slice(0, 128) : undefined
  const lastName = typeof body.last_name === 'string' ? body.last_name.trim().slice(0, 128) : undefined
  const nickname = typeof body.nickname === 'string' ? body.nickname.trim().slice(0, 64) : undefined
  const avatarUrl = typeof body.avatar_url === 'string' ? body.avatar_url.trim().slice(0, 512) : undefined
  const jobTitle = typeof body.job_title === 'string' ? body.job_title.trim().slice(0, 128) : undefined
  const phone = typeof body.phone === 'string' ? body.phone.trim().slice(0, 32) : undefined
  const timezone = typeof body.timezone === 'string' ? body.timezone.trim().slice(0, 64) : undefined
  const statusText = typeof body.status_text === 'string' ? body.status_text.trim().slice(0, 64) : undefined
  const statusEmoji = typeof body.status_emoji === 'string' ? body.status_emoji.trim().slice(0, 8) : undefined
  const pronouns = typeof body.pronouns === 'string' ? body.pronouns.trim().slice(0, 32) : undefined
  const department = typeof body.department === 'string' ? body.department.trim().slice(0, 128) : undefined

  const sets: string[] = []
  const vals: unknown[] = []
  let i = 1
  if (firstName !== undefined) { sets.push(`first_name = $${i++}`); vals.push(firstName) }
  if (lastName !== undefined) { sets.push(`last_name = $${i++}`); vals.push(lastName) }
  if (nickname !== undefined) { sets.push(`nickname = $${i++}`); vals.push(nickname) }
  if (avatarUrl !== undefined) { sets.push(`avatar_url = $${i++}`); vals.push(avatarUrl || null) }
  if (jobTitle !== undefined) { sets.push(`job_title = $${i++}`); vals.push(jobTitle || null) }
  if (phone !== undefined) { sets.push(`phone = $${i++}`); vals.push(phone || null) }
  if (timezone !== undefined) { sets.push(`timezone = $${i++}`); vals.push(timezone || null) }
  if (statusText !== undefined) { sets.push(`status_text = $${i++}`); vals.push(statusText || null) }
  if (statusEmoji !== undefined) { sets.push(`status_emoji = $${i++}`); vals.push(statusEmoji || null) }
  if (pronouns !== undefined) { sets.push(`pronouns = $${i++}`); vals.push(pronouns || null) }
  if (department !== undefined) { sets.push(`department = $${i++}`); vals.push(department || null) }

  if (sets.length === 0) {
    return NextResponse.json({ error: 'no_fields' }, { status: 400 })
  }

  vals.push(uid)
  await pool.query(
    `UPDATE aaelink.users SET ${sets.join(', ')} WHERE id = $${i}`,
    vals
  )

  const ipAddress = req.headers.get('x-forwarded-for') || '127.0.0.1'
  const userAgent = req.headers.get('user-agent') || ''
  await pool.query(`
    INSERT INTO aaelink.audit_log (id, actor_id, actor_role, action, resource_kind, resource_id, ip_address, user_agent, metadata, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [
    randomUUID(), uid, '', 'update_profile', 'user', uid,
    ipAddress, userAgent, JSON.stringify(body), Date.now()
  ])

  const { rows } = await pool.query(
    `SELECT id, username, email, first_name, last_name, nickname, platform_role, avatar_url, job_title, phone, timezone, status_text, status_emoji, pronouns, department FROM aaelink.users WHERE id = $1`,
    [uid]
  )
  return NextResponse.json({ user: rows[0] })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/auth/me', _GET)
export const PUT    = tracedRoute('PUT', '/api/auth/me', _PUT)
