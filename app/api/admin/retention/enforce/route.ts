// keep: enterprise admin surface kept for parity (intentional, not yet wired into UI)
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * POST /api/admin/retention/enforce — execute data retention policies.
 *
 * Purges messages (and optionally files) older than the configured
 * retention window for each enabled scope. Returns summary of actions.
 *
 * In production this would run as a cron job. This endpoint allows
 * manual execution and testing by admins.
 *
 * Scopes:
 *   - workspace: all channel messages across the workspace
 *   - channel:   public/private channel messages
 *   - dm:        direct message conversations
 *   - file:      file attachment metadata
 */
async function _POST() {
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

  // Load enabled retention policies
  const { rows: policies } = await pool.query<{
    scope: string
    retention_days: number
    enabled: boolean
    delete_files: boolean
  }>(`
    SELECT scope, retention_days, enabled, delete_files
    FROM aaelink.retention_policies
    WHERE enabled = true AND retention_days > 0
  `)

  if (policies.length === 0) {
    return NextResponse.json({ message: 'no_enabled_policies', purged: {} })
  }

  const results: Record<string, { messages_deleted: number; files_deleted: number; cutoff_date: string }> = {}

  for (const policy of policies) {
    const cutoffMs = Date.now() - policy.retention_days * 24 * 60 * 60 * 1000
    const cutoffDate = new Date(cutoffMs).toISOString()
    let messagesDeleted = 0
    let filesDeleted = 0

    if (policy.scope === 'workspace' || policy.scope === 'channel') {
      // Delete messages in public/private channels older than cutoff
      const channelTypeFilter = policy.scope === 'channel' ? `AND c.type IN ('O', 'P')` : ''
      const { rowCount } = await pool.query(`
        DELETE FROM aaelink.messages m
        USING aaelink.channels c
        WHERE m.channel_id = c.id
          ${channelTypeFilter}
          AND m.created_at < $1
      `, [cutoffMs])
      messagesDeleted = rowCount || 0
    }

    if (policy.scope === 'dm') {
      // Delete DM messages older than cutoff
      const { rowCount } = await pool.query(`
        DELETE FROM aaelink.messages m
        USING aaelink.channels c
        WHERE m.channel_id = c.id
          AND c.type = 'D'
          AND m.created_at < $1
      `, [cutoffMs])
      messagesDeleted = rowCount || 0
    }

    if (policy.scope === 'file' || policy.delete_files) {
      // Delete file records older than cutoff
      const { rowCount } = await pool.query(`
        DELETE FROM aaelink.documents
        WHERE created_at < $1
      `, [cutoffMs]).catch(() => ({ rowCount: 0 }))
      filesDeleted = rowCount || 0
    }

    results[policy.scope] = {
      messages_deleted: messagesDeleted,
      files_deleted: filesDeleted,
      cutoff_date: cutoffDate
    }

    // Audit this enforcement
    try {
      await pool.query(`
        INSERT INTO aaelink.audit_log (id, actor_id, action, metadata, created_at)
        VALUES (gen_random_uuid(), $1, 'retention.enforce', $2, $3)
      `, [uid, JSON.stringify({ scope: policy.scope, retention_days: policy.retention_days, messages_deleted: messagesDeleted, files_deleted: filesDeleted }), Date.now()])
    } catch { /* best-effort */ }
  }

  return NextResponse.json({
    purged: results,
    policies_executed: policies.length,
    executed_at: new Date().toISOString(),
    executed_by: uid
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/admin/retention/enforce', _POST)
