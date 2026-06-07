import type { Pool } from 'pg'

export type NotificationPrefRule = 'mentions' | 'ticket_activity' | 'system' | 'thread_replies'

/**
 * Returns user ids from `userIds` who are allowed to receive notifications for the given rule.
 * Missing rows default to enabled (same as NOT NULL DEFAULT true on insert).
 */
export async function filterUsersForNotification(
  pool: Pool,
  userIds: string[],
  rule: NotificationPrefRule
): Promise<string[]> {
  const uniq = [...new Set(userIds.filter(Boolean))]
  if (uniq.length === 0) return []
  let sql: string
  if (rule === 'mentions') {
    sql = `SELECT t.user_id::text AS user_id
           FROM unnest($1::text[]) AS t(user_id)
           LEFT JOIN aaelink.user_notification_prefs p ON p.user_id = t.user_id
           WHERE COALESCE(p.mentions_enabled, true) = true`
  } else if (rule === 'ticket_activity') {
    sql = `SELECT t.user_id::text AS user_id
           FROM unnest($1::text[]) AS t(user_id)
           LEFT JOIN aaelink.user_notification_prefs p ON p.user_id = t.user_id
           WHERE COALESCE(p.ticket_activity_enabled, true) = true`
  } else if (rule === 'thread_replies') {
    sql = `SELECT t.user_id::text AS user_id
           FROM unnest($1::text[]) AS t(user_id)
           LEFT JOIN aaelink.user_notification_prefs p ON p.user_id = t.user_id
           WHERE COALESCE(p.thread_replies_enabled, true) = true`
  } else {
    sql = `SELECT t.user_id::text AS user_id
           FROM unnest($1::text[]) AS t(user_id)
           LEFT JOIN aaelink.user_notification_prefs p ON p.user_id = t.user_id
           WHERE COALESCE(p.system_notifications_enabled, true) = true`
  }
  const { rows } = await pool.query<{ user_id: string }>(sql, [uniq])
  return rows.map(r => r.user_id)
}

export type DigestFrequency = 'off' | 'hourly' | 'daily' | 'weekly'

export async function getNotificationPrefsForUser(
  pool: Pool,
  userId: string
): Promise<{
  mentions_enabled: boolean
  ticket_activity_enabled: boolean
  system_notifications_enabled: boolean
  digest_frequency: DigestFrequency
}> {
  const { rows } = await pool.query<{ me: boolean; ta: boolean; sn: boolean; df: string | null }>(
    `SELECT COALESCE(p.mentions_enabled, true) AS me,
            COALESCE(p.ticket_activity_enabled, true) AS ta,
            COALESCE(p.system_notifications_enabled, true) AS sn,
            COALESCE(p.digest_frequency, 'off') AS df
     FROM (SELECT $1::text AS uid) x
     LEFT JOIN aaelink.user_notification_prefs p ON p.user_id = x.uid`,
    [userId]
  )
  const r = rows[0]
  return {
    mentions_enabled: r?.me !== false,
    ticket_activity_enabled: r?.ta !== false,
    system_notifications_enabled: r?.sn !== false,
    digest_frequency: normalizeDigestFrequency(r?.df)
  }
}

/** Coerce an arbitrary stored/input value into a valid DigestFrequency. */
export function normalizeDigestFrequency(value: unknown): DigestFrequency {
  return value === 'hourly' || value === 'daily' || value === 'weekly' ? value : 'off'
}
