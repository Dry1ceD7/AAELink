import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { isPlatformAdmin } from '@/lib/platformRole'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * GET /api/admin/users/export — export all users as CSV.
 * Requires platform admin role.
 */
async function _GET() {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Check admin role
  const { rows: meRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!meRows[0] || !isPlatformAdmin(meRows[0].platform_role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { rows } = await pool.query<{
    id: string; username: string; email: string;
    first_name: string; last_name: string;
    platform_role: string; department: string;
    job_title: string; phone: string; timezone: string;
    created_at: number; last_seen_at: number
  }>(
    `SELECT id, username, email, first_name, last_name,
            platform_role, COALESCE(department, '') AS department,
            COALESCE(job_title, '') AS job_title,
            COALESCE(phone, '') AS phone,
            COALESCE(timezone, '') AS timezone,
            created_at, last_seen_at
     FROM aaelink.users
     ORDER BY username ASC`
  )

  // Build CSV
  const headers = ['ID', 'Username', 'Email', 'First Name', 'Last Name', 'Role', 'Department', 'Job Title', 'Phone', 'Timezone', 'Created At', 'Last Seen']

  const escape = (v: string) => {
    if (v.includes(',') || v.includes('"') || v.includes('\n')) {
      return `"${v.replace(/"/g, '""')}"`
    }
    return v
  }

  const csvLines = [
    headers.join(','),
    ...rows.map(r => [
      escape(r.id),
      escape(r.username),
      escape(r.email),
      escape(r.first_name),
      escape(r.last_name),
      escape(r.platform_role),
      escape(r.department),
      escape(r.job_title),
      escape(r.phone),
      escape(r.timezone),
      r.created_at ? new Date(Number(r.created_at)).toISOString() : '',
      r.last_seen_at ? new Date(Number(r.last_seen_at)).toISOString() : ''
    ].join(','))
  ]

  const csv = csvLines.join('\n')
  const filename = `aaelink-users-${new Date().toISOString().slice(0, 10)}.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store'
    }
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/users/export', _GET)
