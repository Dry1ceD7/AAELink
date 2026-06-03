/**
 * AAELink — Push targeting: decide WHO gets a push, then enqueue delivery.
 *
 * `selectPushTargets` filters a candidate user list down to those who should
 * actually be pushed for a given channel — dropping anyone who muted the
 * channel or is currently in a Do-Not-Disturb window / active snooze. The
 * `push_deliver` worker (lib/notifications/pushDelivery.ts) does NOT apply
 * these preference checks, so they must happen here at enqueue time.
 *
 * `enqueuePush` writes a `push_log` row + a `push_deliver` job per user,
 * producing rows identical to the inline send path in
 * app/api/notifications/push/route.ts (single source of truth).
 */
import { randomUUID } from 'crypto'
import type { Pool } from 'pg'
import { isDndActiveNow } from '@/lib/notifications/dndWindow'

export type PushPriority = 'high' | 'normal' | 'low'

/** Push priority → job-queue priority (lower runs first). Mirrors push route. */
export function jobPriorityFor(p: PushPriority): number {
  return p === 'high' ? 2 : p === 'low' ? 6 : 4
}

/**
 * Filter `userIds` to those eligible for a push on `channelId`: drops users who
 * muted the channel (channel_notification_prefs.muted OR a channel_mutes row)
 * or are currently in DND (active snooze, or enabled schedule window). Returns
 * the allowed subset (deduped; order not significant).
 */
export async function selectPushTargets(
  pool: Pool,
  userIds: string[],
  channelId: string,
  now: number = Date.now(),
): Promise<string[]> {
  const uniq = [...new Set(userIds.filter(Boolean))]
  if (uniq.length === 0) return []

  const { rows: muted } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM aaelink.channel_notification_prefs
       WHERE channel_id = $2 AND user_id = ANY($1) AND muted = true
     UNION
     SELECT user_id FROM aaelink.channel_mutes
       WHERE channel_id = $2 AND user_id = ANY($1)`,
    [uniq, channelId],
  )
  const mutedSet = new Set(muted.map(r => r.user_id))

  const { rows: dnd } = await pool.query<{
    user_id: string
    enabled: boolean
    start_time: string
    end_time: string
    timezone: string
    snooze_until: string
  }>(
    `SELECT user_id, enabled, start_time, end_time, timezone, snooze_until
       FROM aaelink.dnd_settings WHERE user_id = ANY($1)`,
    [uniq],
  )
  const dndSet = new Set<string>()
  const at = new Date(now)
  for (const d of dnd) {
    if (Number(d.snooze_until) > now) {
      dndSet.add(d.user_id)
      continue
    }
    if (d.enabled && isDndActiveNow(d.start_time, d.end_time, d.timezone, at)) {
      dndSet.add(d.user_id)
    }
  }

  return uniq.filter(u => !mutedSet.has(u) && !dndSet.has(u))
}

export interface EnqueuePushArgs {
  userIds: string[]
  title: string
  body: string
  channelId?: string
  priority?: PushPriority
  badgeCount?: number
  silent?: boolean
}

/**
 * Write a push_log row + enqueue a `push_deliver` job per user (capped at 100).
 * Returns the number of jobs enqueued. `createdBy` stamps the job's owner.
 */
export async function enqueuePush(
  pool: Pool,
  args: EnqueuePushArgs,
  createdBy: string,
): Promise<number> {
  const userIds = [...new Set(args.userIds.filter(Boolean))]
  if (userIds.length === 0) return 0
  const priority: PushPriority =
    args.priority === 'high' || args.priority === 'low' ? args.priority : 'normal'
  const jobPriority = jobPriorityFor(priority)
  const now = Date.now()
  let queued = 0

  for (const targetId of userIds.slice(0, 100)) {
    const logId = randomUUID()
    await pool.query(
      `INSERT INTO aaelink.push_log
         (id, user_id, title, body, channel_id, priority, silent, badge_count, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', $9)`,
      [logId, targetId, args.title, args.body, args.channelId || '',
        priority, args.silent || false, args.badgeCount || 0, now],
    )
    await pool.query(
      `INSERT INTO aaelink.jobs
         (id, type, status, priority, payload, run_after, max_retries, attempts, created_by, created_at)
       VALUES ($1, 'push_deliver', 'pending', $2, $3, $4, 3, 0, $5, $4)`,
      [randomUUID(), jobPriority, JSON.stringify({
        user_id: targetId,
        title: args.title,
        body: args.body,
        channel_id: args.channelId || '',
        badge_count: args.badgeCount || 0,
        silent: args.silent || false,
        priority,
        log_id: logId,
      }), now, createdBy],
    )
    queued++
  }
  return queued
}
