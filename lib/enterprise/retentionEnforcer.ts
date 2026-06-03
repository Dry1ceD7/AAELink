/**
 * Retention enforcement helpers.
 *
 * Deletes messages/files older than each enabled retention policy window,
 * scoped by channel type, while NEVER deleting content under an active legal
 * hold. Legal holds protect content by channel and/or by time window
 * (scope_from..scope_to); a hold with empty channel_ids protects all channels.
 *
 * Schema notes (verified against lib/infra/migrate.ts):
 *   - aaelink.messages.created_at        BIGINT (ms)
 *   - aaelink.channels.type              'O'|'P' (channels), 'D' (DM)
 *   - aaelink.file_attachments.created_at BIGINT (ms)
 *   - aaelink.legal_holds(status, channel_ids JSONB, scope_from, scope_to)
 */
import type { Pool } from 'pg'

export interface RetentionPolicyRow {
  scope: string
  retention_days: number
  enabled: boolean
  delete_files: boolean
}

export interface ActiveHold {
  channelIds: string[]
  scopeFrom: number
  scopeTo: number
}

export interface RetentionResult {
  scope: string
  cutoffMs: number
  messagesDeleted: number
  filesDeleted: number
}

const DAY_MS = 24 * 60 * 60 * 1000

export function cutoffForPolicy(retentionDays: number, now = Date.now()): number {
  return now - retentionDays * DAY_MS
}

/** Load active legal holds (status='active', not released). */
export async function loadActiveHolds(pool: Pool): Promise<ActiveHold[]> {
  const { rows } = await pool.query<{
    channel_ids: unknown; scope_from: string | number; scope_to: string | number
  }>(
    `SELECT channel_ids, scope_from, scope_to
       FROM aaelink.legal_holds
      WHERE status = 'active' AND COALESCE(released_at, 0) = 0`
  )
  return rows.map((r) => ({
    channelIds: Array.isArray(r.channel_ids) ? (r.channel_ids as string[]) : [],
    scopeFrom: Number(r.scope_from || 0),
    scopeTo: Number(r.scope_to || 0),
  }))
}

/**
 * Pure: does an active hold protect a message in `channelId` created at
 * `createdAt`? A hold matches a channel when it lists that channel OR lists
 * none (all-channel hold). It matches the time when createdAt falls inside
 * [scope_from, scope_to]; scope_to=0 means "open-ended / forever".
 */
export function isUnderHold(
  holds: ActiveHold[],
  channelId: string,
  createdAt: number
): boolean {
  for (const h of holds) {
    const channelMatch = h.channelIds.length === 0 || h.channelIds.includes(channelId)
    if (!channelMatch) continue
    const afterFrom = createdAt >= (h.scopeFrom || 0)
    const beforeTo = h.scopeTo === 0 || createdAt <= h.scopeTo
    if (afterFrom && beforeTo) return true
  }
  return false
}

/**
 * Build the SQL fragment + params that EXCLUDE held content from a delete.
 * Returns a clause to AND into the WHERE, plus the params it consumes.
 * `nextParamIndex` is the next $N placeholder number to use.
 */
export function buildHoldExclusion(
  holds: ActiveHold[],
  channelCol: string,
  createdAtCol: string,
  nextParamIndex: number
): { clause: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []
  let idx = nextParamIndex
  for (const h of holds) {
    const conds: string[] = []
    if (h.channelIds.length > 0) {
      params.push(h.channelIds)
      conds.push(`${channelCol} = ANY($${idx++}::text[])`)
    }
    params.push(h.scopeFrom || 0)
    conds.push(`${createdAtCol} >= $${idx++}`)
    if (h.scopeTo > 0) {
      params.push(h.scopeTo)
      conds.push(`${createdAtCol} <= $${idx++}`)
    }
    // A row is protected if it matches ALL of this hold's conditions.
    clauses.push(`(${conds.join(' AND ')})`)
  }
  if (clauses.length === 0) return { clause: '', params: [] }
  // Exclude any row protected by ANY hold.
  return { clause: ` AND NOT (${clauses.join(' OR ')})`, params }
}
