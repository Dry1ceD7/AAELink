import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { isPlatformAdmin } from '@/lib/platformRole'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * POST /api/admin/audit-log/export — compliance export of audit logs.
 *
 * Body: { workspace_id?, from?: epoch, to?: epoch, format?: 'json'|'csv' }
 *
 * Returns full audit log dump for the time window, formatted for
 * compliance officers and security auditors. Max 10,000 records per export.
 */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!isPlatformAdmin(uRows[0]?.platform_role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    workspace_id?: string
    from?: number
    to?: number
    format?: 'json' | 'csv'
  }

  const from = body.from || 0
  const to = body.to || Date.now()
  const format = body.format || 'json'
  const workspaceId = String(body.workspace_id || '').trim()

  let sql = `
    SELECT al.id, al.workspace_id, al.actor_id, al.action,
           al.resource_id, al.metadata, al.created_at,
           u.username AS actor_username, u.email AS actor_email
    FROM aaelink.audit_log al
    LEFT JOIN aaelink.users u ON u.id = al.actor_id
    WHERE al.created_at >= $1 AND al.created_at <= $2
  `
  const params: (string | number)[] = [from, to]

  if (workspaceId) {
    sql += ` AND al.workspace_id = $3`
    params.push(workspaceId)
  }

  sql += ` ORDER BY al.created_at ASC LIMIT 10000`

  const { rows } = await pool.query(sql, params)

  if (format === 'csv') {
    const headers = ['id', 'workspace_id', 'actor_id', 'actor_username', 'actor_email', 'action', 'resource_id', 'metadata', 'created_at']
    const csvLines = [headers.join(',')]
    const typedRows = rows as Array<Record<string, unknown>>
    for (const r of typedRows) {
      const line = headers.map(h => {
        const val = String(r[h] ?? '')
        return val.includes(',') || val.includes('"') || val.includes('\n')
          ? `"${val.replace(/"/g, '""')}"`
          : val
      })
      csvLines.push(line.join(','))
    }
    return new NextResponse(csvLines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit-log-${new Date().toISOString().split('T')[0]}.csv"`
      }
    })
  }

  return NextResponse.json({
    export: rows,
    count: rows.length,
    from,
    to,
    exported_at: new Date().toISOString(),
    exported_by: uid
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/admin/audit-log/export', _POST)
