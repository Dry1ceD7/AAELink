// keep: enterprise admin surface kept for parity (intentional, not yet wired into UI)
import { NextResponse } from 'next/server'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import {
  BulkProvisionEngine,
  parseCsv,
  type BulkUserRecord,
} from '@/lib/enterprise/bulkProvision'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { hashPassword } from '@/lib/auth/password'

async function requireAdmin(): Promise<{ uid: string } | NextResponse> {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const { rows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  const role = rows[0]?.platform_role || ''
  if (role !== 'admin' && role !== 'super_admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  return { uid }
}

// ── POST — bulk import users ─────────────────────────────────────────
async function _POST(req: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()

  const body = (await req.json()) as {
    format?: 'csv' | 'json'
    data?: string | BulkUserRecord[]
    preview?: boolean
    conflict_strategy?: 'skip' | 'overwrite' | 'merge'
    default_password?: string
    default_role?: string
    auto_join_workspace_id?: string
  }

  // Parse records
  let records: BulkUserRecord[]
  if (body.format === 'csv' && typeof body.data === 'string') {
    records = parseCsv(body.data)
  } else if (Array.isArray(body.data)) {
    records = body.data
  } else {
    return NextResponse.json({ error: 'invalid_data_format', hint: 'Use format:"csv" with string data, or format:"json" with array' }, { status: 400 })
  }

  if (records.length === 0) {
    return NextResponse.json({ error: 'no_records', hint: 'No valid user records found in the input data' }, { status: 400 })
  }

  if (records.length > 10000) {
    return NextResponse.json({ error: 'too_many_records', max: 10000 }, { status: 400 })
  }

  const engine = new BulkProvisionEngine({
    conflict_strategy: body.conflict_strategy || 'skip',
    default_password: body.default_password,
    default_role: body.default_role || 'member',
    auto_join_workspace_id: body.auto_join_workspace_id,
  })

  // Preview mode
  if (body.preview) {
    const result = engine.preview(records)
    return NextResponse.json(result)
  }

  // Execute
  const defaultPwHash = hashPassword(body.default_password || 'AAELink@2026')
  const now = Date.now()

  const result = await engine.execute(
    records,
    // Lookup
    async (username, email) => {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM aaelink.users WHERE lower(username) = lower($1) OR lower(email) = lower($2) LIMIT 1`,
        [username, email]
      )
      return rows[0]?.id || null
    },
    // Create
    async (rec) => {
      const pwHash = rec.password ? hashPassword(rec.password) : defaultPwHash
      await pool.query(
        `INSERT INTO aaelink.users (id, username, email, password_hash, first_name, last_name, nickname, job_title, phone, timezone, platform_role, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          rec.id, rec.username, rec.email, pwHash,
          rec.first_name || '', rec.last_name || '', rec.nickname || '',
          rec.job_title || '', rec.phone || '', rec.timezone || 'Asia/Bangkok',
          rec.platform_role || 'member', now,
        ]
      )
      // Auto-join workspace if configured
      if (body.auto_join_workspace_id) {
        await pool.query(
          `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role, joined_at)
           VALUES ($1, $2, 'member', $3)
           ON CONFLICT (workspace_id, user_id) DO NOTHING`,
          [body.auto_join_workspace_id, rec.id, now]
        )
      }
    },
    // Update
    async (userId, rec) => {
      const sets: string[] = ['updated_at = $2']
      const params: (string | number)[] = [userId, now]
      if (rec.first_name) { params.push(rec.first_name); sets.push(`first_name = $${params.length}`) }
      if (rec.last_name) { params.push(rec.last_name); sets.push(`last_name = $${params.length}`) }
      if (rec.nickname) { params.push(rec.nickname); sets.push(`nickname = $${params.length}`) }
      if (rec.job_title) { params.push(rec.job_title); sets.push(`job_title = $${params.length}`) }
      if (rec.phone) { params.push(rec.phone); sets.push(`phone = $${params.length}`) }
      if (rec.timezone) { params.push(rec.timezone); sets.push(`timezone = $${params.length}`) }
      if (rec.platform_role) { params.push(rec.platform_role); sets.push(`platform_role = $${params.length}`) }
      await pool.query(`UPDATE aaelink.users SET ${sets.join(', ')} WHERE id = $1`, params)
    },
  )

  return NextResponse.json(result)
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST = tracedRoute('POST', '/api/admin/bulk-provision', _POST)
