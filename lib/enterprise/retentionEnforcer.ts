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
  custodianIds: string[]
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
    channel_ids: unknown; custodian_ids: unknown
    scope_from: string | number; scope_to: string | number
  }>(
    `SELECT channel_ids, custodian_ids, scope_from, scope_to
       FROM aaelink.legal_holds
      WHERE status = 'active' AND COALESCE(released_at, 0) = 0`
  )
  return rows.map((r) => ({
    channelIds: Array.isArray(r.channel_ids) ? (r.channel_ids as string[]) : [],
    custodianIds: Array.isArray(r.custodian_ids) ? (r.custodian_ids as string[]) : [],
    scopeFrom: Number(r.scope_from || 0),
    scopeTo: Number(r.scope_to || 0),
  }))
}

/**
 * Pure: does an active hold protect content owned by `userId` in `channelId`
 * created at `createdAt`? A hold matches when it lists that channel, lists that
 * custodian, OR lists neither (all-content hold). It matches the time when
 * createdAt falls inside [scope_from, scope_to]; scope_to=0 means
 * "open-ended / forever".
 *
 * `channelId` may be null/empty for an unattached file (file_attachments allows
 * NULL channel_id). Such a row cannot be proven outside a channel-scoped hold,
 * so a channel-scoped hold conservatively protects it (matches the SQL path in
 * buildFileHoldExclusion).
 */
export function isUnderHold(
  holds: ActiveHold[],
  channelId: string | null | undefined,
  createdAt: number,
  userId?: string | null
): boolean {
  for (const h of holds) {
    const hasChannelScope = h.channelIds.length > 0
    const hasCustodianScope = h.custodianIds.length > 0
    // All-content hold (no channel, no custodian) matches everything in time.
    let scopeMatch = !hasChannelScope && !hasCustodianScope
    if (!scopeMatch && hasChannelScope) {
      // A row whose channel is unknown (null/empty) cannot be proven outside a
      // channel-scoped hold → treat as a match (conservative protection).
      if (!channelId || h.channelIds.includes(channelId)) scopeMatch = true
    }
    if (!scopeMatch && hasCustodianScope && userId && h.custodianIds.includes(userId)) {
      scopeMatch = true
    }
    if (!scopeMatch) continue
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
 *
 * When `custodianCol` is provided, a hold's custodian dimension also protects
 * rows owned by a listed custodian (`custodianCol = ANY(...)`). A hold's
 * channel/custodian scopes are ORed (matching either protects); the time window
 * is ANDed. A hold with neither channels nor custodians (an all-content hold)
 * protects everything in its time window. This is the shared builder for the
 * message path; the file path uses buildFileHoldExclusion, which additionally
 * protects rows whose channel_id IS NULL when a channel-scoped hold is active.
 */
export function buildHoldExclusion(
  holds: ActiveHold[],
  channelCol: string,
  createdAtCol: string,
  nextParamIndex: number,
  custodianCol?: string
): { clause: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []
  let idx = nextParamIndex
  for (const h of holds) {
    const scopeConds: string[] = []
    if (h.channelIds.length > 0) {
      params.push(h.channelIds)
      scopeConds.push(`${channelCol} = ANY($${idx++}::text[])`)
    }
    if (custodianCol && h.custodianIds.length > 0) {
      params.push(h.custodianIds)
      scopeConds.push(`${custodianCol} = ANY($${idx++}::text[])`)
    }
    const conds: string[] = []
    // Channel OR custodian scope (either dimension protects). If a hold lists
    // neither (all-content hold) there is no scope predicate — only the time
    // window applies, so it protects everything in window.
    if (scopeConds.length === 1) conds.push(scopeConds[0])
    else if (scopeConds.length > 1) conds.push(`(${scopeConds.join(' OR ')})`)
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

/**
 * File-specific hold exclusion. Builds on buildHoldExclusion (channel + time +
 * custodian via `userCol`) and adds the load-bearing safety the irreversible
 * file purge requires: a file row with channel_id IS NULL (an unattached upload
 * — file_attachments allows NULL channel_id, migration 033) cannot be proven to
 * fall outside a channel-scoped hold. Because deleteFiles now destroys the
 * underlying bytes irreversibly, such a row MUST be protected whenever any
 * channel-scoped hold is active. We therefore add `channelCol IS NULL` as an
 * extra protective branch when any active hold carries a channel scope.
 *
 * `channelCol` must be a bare column reference (no alias) usable both as the
 * `= ANY(...)` operand and as `IS NULL` — deleteFiles passes 'channel_id'.
 */
export function buildFileHoldExclusion(
  holds: ActiveHold[],
  channelCol: string,
  createdAtCol: string,
  userCol: string,
  nextParamIndex: number
): { clause: string; params: unknown[] } {
  const base = buildHoldExclusion(holds, channelCol, createdAtCol, nextParamIndex, userCol)
  const anyChannelScoped = holds.some((h) => h.channelIds.length > 0)
  if (!anyChannelScoped) return base

  // Protect unattached (NULL-channel) files while any channel-scoped hold exists.
  const nullGuard = `${channelCol} IS NULL`
  if (base.clause === '') {
    // No per-hold clauses emitted (e.g. a single channel hold produced params
    // but buildHoldExclusion always emits a time predicate, so this branch is
    // effectively unreachable — kept for total correctness).
    return { clause: ` AND NOT (${nullGuard})`, params: base.params }
  }
  // base.clause is ` AND NOT (<protected>)`; widen the protected set with the
  // null guard so NULL-channel rows are also kept (excluded from the delete).
  const inner = base.clause.replace(/^ AND NOT \(/, '').replace(/\)$/, '')
  return { clause: ` AND NOT (${inner} OR ${nullGuard})`, params: base.params }
}
