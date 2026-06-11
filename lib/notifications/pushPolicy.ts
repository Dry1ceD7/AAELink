/**
 * AAELink — Admin push-policy enforcement (org quiet hours + per-user rate cap).
 *
 * The admin push policy is persisted by app/api/notifications/push/route.ts into
 * aaelink.system_config under the `push_policy` key, but nothing consulted it at
 * push time. This module reads the stored policy and exposes two enforcement
 * helpers used by selectPushTargets (lib/notifications/pushTargeting.ts), the
 * single chokepoint where per-user push filtering already happens (mute + DND):
 *
 *   - applyQuietHours(): during the org-wide quiet-hours window (TZ-aware, reusing
 *     the same isDndActiveNow helper as per-user DND), ALL targets are dropped.
 *   - applyMaxRate(): caps each user at `max_rate_per_user_per_hour` pushes over a
 *     rolling 1h window, reusing the cross-replica counter in lib/api/rateLimitStore.
 *
 * ABSENT / DISABLED policy → no-op. Enforcement only engages when an admin has
 * actually saved a push_policy row AND `enabled` is true; an absent row returns
 * null here and both helpers pass every target through unchanged.
 */
import type { Pool } from 'pg'
import { isDndActiveNow } from '@/lib/notifications/dndWindow'
import { checkLimit } from '@/lib/api/rateLimitStore'

const POLICY_KEY = 'push_policy'
const HOUR_MS = 3_600_000

export interface PushPolicy {
  enabled: boolean
  quiet_hours_start: string
  quiet_hours_end: string
  quiet_hours_timezone: string
  max_rate_per_user_per_hour: number
}

/**
 * Read the stored admin push policy. Returns null when no policy row exists
 * (absent → enforcement no-op) or when the stored JSON is unparseable. Only the
 * enforcement-relevant fields are surfaced; missing fields fall back to the same
 * defaults the admin route uses.
 */
export async function getPushPolicy(pool: Pool): Promise<PushPolicy | null> {
  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = $1`, [POLICY_KEY],
  )
  const raw = rows[0]?.value
  if (!raw) return null
  let parsed: Partial<PushPolicy>
  try {
    parsed = JSON.parse(raw) as Partial<PushPolicy>
  } catch {
    return null
  }
  return {
    enabled: parsed.enabled !== false,
    quiet_hours_start: parsed.quiet_hours_start || '22:00',
    quiet_hours_end: parsed.quiet_hours_end || '07:00',
    quiet_hours_timezone: parsed.quiet_hours_timezone || 'UTC',
    max_rate_per_user_per_hour: Number(parsed.max_rate_per_user_per_hour) || 0,
  }
}

/**
 * Org quiet-hours gate. When the policy is active and `at` falls inside the
 * org-wide quiet-hours window (TZ-aware), every target is dropped (deferred).
 * Disabled policy, equal start/end, or `at` outside the window → all pass.
 */
export function applyQuietHours(
  policy: PushPolicy | null, userIds: string[], at: Date,
): string[] {
  if (!policy || !policy.enabled) return userIds
  const inQuiet = isDndActiveNow(
    policy.quiet_hours_start, policy.quiet_hours_end, policy.quiet_hours_timezone, at,
  )
  return inQuiet ? [] : userIds
}

/**
 * Per-user max-rate gate. Caps each user at `max_rate_per_user_per_hour` pushes
 * over a rolling 1h window via the cross-replica rate-limit counter. Users at or
 * past the cap are dropped. A non-positive cap, disabled policy, or absent policy
 * → all pass (no counter writes). Each surviving user consumes one count, so this
 * must run AFTER mute/DND filtering so only real pushes are counted.
 */
export async function applyMaxRate(
  policy: PushPolicy | null, userIds: string[],
): Promise<string[]> {
  if (!policy || !policy.enabled || policy.max_rate_per_user_per_hour <= 0) return userIds
  const max = policy.max_rate_per_user_per_hour
  const allowed: string[] = []
  for (const u of userIds) {
    const verdict = await checkLimit(`push:${u}`, max, HOUR_MS)
    if (verdict.ok) allowed.push(u)
  }
  return allowed
}
