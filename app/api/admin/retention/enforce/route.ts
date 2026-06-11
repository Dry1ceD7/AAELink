// keep: enterprise admin surface kept for parity (intentional, not yet wired into UI)
import { NextResponse, type NextRequest } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { writeAuditLog } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * POST /api/admin/retention/enforce — execute data retention policies.
 *
 * Manual trigger of the SAME hold-aware engine the worker uses
 * (runRetentionEnforcement → buildHoldExclusion). Purges messages (and
 * optionally files) older than each enabled scope's window while NEVER deleting
 * content protected by an active legal hold. The engine audits per policy; this
 * route adds an actor-attributed audit row for the manual trigger.
 *
 * Scopes: workspace | channel | dm | file (see retention_policies).
 */
async function _POST(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf

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

  // Delegate to the shared, hold-aware engine — no duplicate DELETE SQL here.
  const { runRetentionEnforcement } = await import('@/lib/enterprise/retentionJob')
  const results = await runRetentionEnforcement(pool)

  if (results.length === 0) {
    return NextResponse.json({ message: 'no_enabled_policies', purged: {} })
  }

  const purged: Record<string, {
    messages_deleted: number; files_deleted: number; cutoff_date: string
  }> = {}
  for (const r of results) {
    purged[r.scope] = {
      messages_deleted: r.messagesDeleted,
      files_deleted: r.filesDeleted,
      cutoff_date: new Date(r.cutoffMs).toISOString(),
    }
  }

  // Actor-attributed audit for the manual trigger (the engine also audits each
  // policy's deletion details internally).
  writeAuditLog({
    pool,
    actorId: uid,
    action: 'retention.enforce',
    resourceKind: 'system',
    resourceId: 'retention',
    metadata: { policies_executed: results.length, scopes: results.map((r) => r.scope) },
  })

  return NextResponse.json({
    purged,
    policies_executed: results.length,
    executed_at: new Date().toISOString(),
    executed_by: uid,
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/admin/retention/enforce', _POST)
