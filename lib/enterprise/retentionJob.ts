/**
 * retention_enforce job orchestration.
 *
 * Reads enabled retention policies, computes per-scope cutoffs, and deletes
 * messages / file_attachments older than the window — while excluding any
 * content protected by an active legal hold. Audited via writeAuditLog.
 */
import type { Pool } from 'pg'
import {
  cutoffForPolicy, loadActiveHolds, buildHoldExclusion,
  type RetentionPolicyRow, type RetentionResult,
} from './retentionEnforcer'
import { writeAuditLog } from './auditLog'

const CHANNEL_TYPE_BY_SCOPE: Record<string, string[]> = {
  workspace: [], // all channels
  channel: ['O', 'P'],
  dm: ['D'],
}

async function deleteMessages(
  pool: Pool, cutoffMs: number, channelTypes: string[], holdsClause: string, holdsParams: unknown[]
): Promise<number> {
  const params: unknown[] = [cutoffMs]
  let typeFilter = ''
  if (channelTypes.length > 0) {
    params.push(channelTypes)
    typeFilter = ` AND c.type = ANY($${params.length}::text[])`
  }
  // Hold params follow the message params; re-number happens at call site.
  const { rowCount } = await pool.query(
    `DELETE FROM aaelink.messages m
       USING aaelink.channels c
      WHERE m.channel_id = c.id
        AND m.created_at < $1${typeFilter}${holdsClause}`,
    [...params, ...holdsParams]
  )
  return rowCount || 0
}

async function deleteFiles(
  pool: Pool, cutoffMs: number, holdsClause: string, holdsParams: unknown[]
): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM aaelink.file_attachments
      WHERE created_at < $1${holdsClause}`,
    [cutoffMs, ...holdsParams]
  )
  return rowCount || 0
}

export async function runRetentionEnforcement(pool: Pool): Promise<RetentionResult[]> {
  const { rows: policies } = await pool.query<RetentionPolicyRow>(
    `SELECT scope, retention_days, enabled, delete_files
       FROM aaelink.retention_policies
      WHERE enabled = true AND retention_days > 0`
  )
  if (policies.length === 0) return []

  const holds = await loadActiveHolds(pool)
  const results: RetentionResult[] = []

  for (const p of policies) {
    const cutoffMs = cutoffForPolicy(p.retention_days)
    let messagesDeleted = 0
    let filesDeleted = 0

    const channelTypes = CHANNEL_TYPE_BY_SCOPE[p.scope] ?? []
    const isMessageScope = p.scope === 'workspace' || p.scope === 'channel' || p.scope === 'dm'

    if (isMessageScope) {
      // Message hold exclusion keys off m.channel_id / m.created_at.
      // Params already used: $1 cutoff, then optional channelTypes.
      const nextIdx = channelTypes.length > 0 ? 3 : 2
      const ex = buildHoldExclusion(holds, 'm.channel_id', 'm.created_at', nextIdx)
      messagesDeleted = await deleteMessages(pool, cutoffMs, channelTypes, ex.clause, ex.params)
    }

    if (p.scope === 'file' || p.delete_files) {
      const ex = buildHoldExclusion(holds, 'channel_id', 'created_at', 2)
      filesDeleted = await deleteFiles(pool, cutoffMs, ex.clause, ex.params)
    }

    results.push({ scope: p.scope, cutoffMs, messagesDeleted, filesDeleted })

    writeAuditLog({
      pool,
      action: 'retention.enforce',
      resourceKind: 'policy',
      resourceId: p.scope,
      metadata: {
        scope: p.scope, retention_days: p.retention_days,
        messages_deleted: messagesDeleted, files_deleted: filesDeleted,
        active_holds: holds.length,
      },
    })
  }

  return results
}
