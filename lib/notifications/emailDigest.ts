/**
 * AAELink — missed-activity email digests (Notifications parity §27 / BLUEPRINT §2.1.5).
 *
 * The audit found per-event email but no digest aggregation. This collects a
 * user's UNREAD, since-watermark notifications (mentions / DMs / keyword hits),
 * composes a plain-text (+ minimal HTML) summary, and the worker job
 * ('email_digest') sends it via lib/notifications/emailSender and advances the
 * per-user watermark (user_notification_prefs.last_digest_at).
 *
 * Design notes:
 *   - No template engine (Hard Rule #7); compose is pure string building.
 *   - "Unread" = notifications.read_at = 0; "since watermark" = created_at >
 *     last_digest_at. We intentionally only summarize the high-signal kinds Slack
 *     digests (mentions, DMs, keyword) — not every channel_message.
 *   - Email sends regardless of DND (digests are a daily/weekly summary, not a
 *     realtime ping); we do not gate on dnd_settings here.
 */

import type { Pool } from 'pg'
import { sendEmail } from '@/lib/notifications/emailSender'

export type DigestFrequency = 'off' | 'daily' | 'weekly'

/** The notification kinds a digest summarizes (high-signal only). */
export const DIGEST_KINDS = ['mention', 'dm', 'keyword'] as const

export interface DigestItem {
  id: string
  kind: string
  title: string
  body: string
  created_at: number
}

export interface DigestPayload {
  user_id: string
  email: string
  subject: string
  text: string
  html: string
  item_count: number
  /** Newest collected notification's created_at — the new watermark. */
  high_watermark: number
}

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS

/** Frequency → minimum interval between digests. */
export function digestIntervalMs(freq: DigestFrequency): number {
  if (freq === 'weekly') return WEEK_MS
  if (freq === 'daily') return DAY_MS
  return Number.POSITIVE_INFINITY
}

/**
 * Whether a user is due for a digest now. Gated by the CADENCE TIMER
 * (last_digest_sent_at = the time we last sent), NOT the content watermark — those
 * are two distinct concerns (migration 039). A brand-new opted-in user (timer 0)
 * is due on the first eligible tick.
 */
export function isDigestDue(freq: DigestFrequency, lastSentAt: number, now = Date.now()): boolean {
  if (freq === 'off') return false
  return now - Number(lastSentAt || 0) >= digestIntervalMs(freq)
}

/** One page of the digest backlog query (bounded). */
const DIGEST_PAGE_SIZE = 50
/** Max pages drained per user per run so a pathological backlog can't run forever. */
const MAX_DIGEST_PAGES_PER_RUN = 40

/**
 * Collect ONE page of a user's unread, since-cursor digestable notifications,
 * oldest-first. Pages on the (created_at, id) keyset so a moving cursor resumes
 * strictly after the last item WITHOUT losing rows that share the boundary's
 * created_at (the millisecond-tie bug). Pure read — mutates no watermark.
 *
 * Two cursor modes (locale-safe — no string-collation sentinel):
 *   - FIRST page (cursorId === null): boundary is `created_at > cursorAt`, strict on
 *     the timestamp only. This is what makes the persisted single-timestamp
 *     watermark dedup correctly across runs — a same-ms item already summarized last
 *     run is NOT re-summarized.
 *   - MID-drain page (cursorId is a real id): boundary is the keyset
 *     `(created_at, id) > (cursorAt, cursorId)` so same-ms ties at a page boundary
 *     are drained in order, never skipped.
 */
export async function collectDigestItems(
  pool: Pool,
  userId: string,
  sinceCursor: number,
  cursorId: string | null = null,
  limit = DIGEST_PAGE_SIZE
): Promise<DigestItem[]> {
  const boundary = cursorId === null
    ? `created_at > $2::bigint`
    : `(created_at, id) > ($2::bigint, $3)`
  const params: unknown[] = cursorId === null
    ? [userId, Number(sinceCursor || 0), DIGEST_KINDS as unknown as string[], limit]
    : [userId, Number(sinceCursor || 0), cursorId, DIGEST_KINDS as unknown as string[], limit]
  const kindsParam = cursorId === null ? '$3' : '$4'
  const limitParam = cursorId === null ? '$4' : '$5'
  const { rows } = await pool.query<{ id: string; kind: string; title: string; body: string; created_at: string }>(
    `SELECT id, kind, title, body, created_at::text AS created_at
       FROM aaelink.notifications
      WHERE user_id = $1
        AND read_at = 0
        AND ${boundary}
        AND kind = ANY(${kindsParam}::text[])
      ORDER BY created_at ASC, id ASC
      LIMIT ${limitParam}`,
    params
  )
  return rows.map(r => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    created_at: Number(r.created_at),
  }))
}

/**
 * Drain a user's whole since-watermark backlog by paging oldest-first on the
 * (created_at, id) keyset (same gap-free shape as savedSearchAlerts), so a burst of
 * >PAGE_SIZE notifications is fully summarized in ONE digest and the watermark
 * never jumps over un-summarized items — including same-millisecond ties at a page
 * boundary. Bounded by MAX_DIGEST_PAGES_PER_RUN; any overflow beyond the cap
 * resumes exactly where we stopped on the next run.
 */
export async function collectAllDigestItems(
  pool: Pool,
  userId: string,
  sinceWatermark: number
): Promise<DigestItem[]> {
  const items: DigestItem[] = []
  let cursorAt = Number(sinceWatermark || 0)
  // First page: cursorId=null ⇒ strict `created_at > watermark` (cross-run dedup).
  // Subsequent pages: real id ⇒ tie-safe keyset within this run.
  let cursorId: string | null = null
  for (let page = 0; page < MAX_DIGEST_PAGES_PER_RUN; page++) {
    const batch = await collectDigestItems(pool, userId, cursorAt, cursorId, DIGEST_PAGE_SIZE)
    if (batch.length === 0) break
    items.push(...batch)
    const last = batch[batch.length - 1]
    cursorAt = last.created_at
    cursorId = last.id
    if (batch.length < DIGEST_PAGE_SIZE) break // drained
  }
  return items
}

const KIND_LABEL: Record<string, string> = {
  mention: 'Mentions',
  dm: 'Direct messages',
  keyword: 'Keyword highlights',
}

/**
 * Compose a plain-text + minimal-HTML digest from collected items. Pure and
 * unit-testable. Groups items by kind in a stable order. Returns null when there
 * is nothing to send (caller should still advance the watermark to "now").
 */
export function composeDigest(
  freq: DigestFrequency,
  items: DigestItem[]
): { subject: string; text: string; html: string } | null {
  if (items.length === 0) return null

  const period = freq === 'weekly' ? 'weekly' : 'daily'
  const subject = `Your AAELink ${period} digest — ${items.length} new ${items.length === 1 ? 'item' : 'items'}`

  const textLines: string[] = [
    `You have ${items.length} unread ${items.length === 1 ? 'notification' : 'notifications'} since your last digest.`,
    '',
  ]
  const htmlParts: string[] = [
    `<p>You have <strong>${items.length}</strong> unread ${items.length === 1 ? 'notification' : 'notifications'} since your last digest.</p>`,
  ]

  for (const kind of DIGEST_KINDS) {
    const group = items.filter(i => i.kind === kind)
    if (group.length === 0) continue
    const label = KIND_LABEL[kind] ?? kind
    textLines.push(`${label} (${group.length}):`)
    htmlParts.push(`<h3>${escapeHtml(label)} (${group.length})</h3>`, '<ul>')
    for (const it of group) {
      const line = it.title ? `${it.title}: ${it.body}` : it.body
      textLines.push(`  • ${line}`)
      htmlParts.push(`<li>${escapeHtml(line)}</li>`)
    }
    htmlParts.push('</ul>')
    textLines.push('')
  }

  return {
    subject,
    text: textLines.join('\n').trimEnd() + '\n',
    html: htmlParts.join('\n'),
  }
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface DigestRunResult {
  considered: number
  sent: number
  skipped_empty: number
  watermarks_advanced: number
}

/**
 * One digest pass. For every user with digest_frequency != 'off' that is DUE,
 * drain the backlog → compose → send → advance both stamps:
 *
 *   - last_digest_at      (content WATERMARK): advanced to the newest item we
 *     actually summarized this run (NOT to `now`), so any backlog overflow beyond
 *     the per-run page cap survives to the next run and is never silently dropped.
 *     On an empty run it advances to `now` (there is nothing before now to send).
 *   - last_digest_sent_at (cadence TIMER): always set to `now`, so the interval is
 *     measured from send time — not from a past message's created_at — and cadence
 *     does not drift (the column-overload bug in 038).
 *
 * Dueness is gated by the cadence timer. SMTP-unconfigured deployments still advance
 * both stamps (the sender no-ops), so enabling SMTP later does not replay old
 * digests. Idempotent enough for retry: a partial run leaves advanced users alone.
 */
export async function runEmailDigests(pool: Pool, now = Date.now()): Promise<DigestRunResult> {
  const { rows: users } = await pool.query<{
    user_id: string; email: string; digest_frequency: string
    last_digest_at: string; last_digest_sent_at: string
  }>(
    `SELECT p.user_id, u.email,
            p.digest_frequency,
            COALESCE(p.last_digest_at, 0)::text AS last_digest_at,
            COALESCE(p.last_digest_sent_at, 0)::text AS last_digest_sent_at
       FROM aaelink.user_notification_prefs p
       INNER JOIN aaelink.users u ON u.id = p.user_id
      WHERE p.digest_frequency <> 'off'
        AND u.email IS NOT NULL AND u.email <> ''`
  )

  const result: DigestRunResult = { considered: 0, sent: 0, skipped_empty: 0, watermarks_advanced: 0 }

  for (const row of users) {
    const freq = row.digest_frequency as DigestFrequency
    const lastSentAt = Number(row.last_digest_sent_at || 0)
    if (!isDigestDue(freq, lastSentAt, now)) continue
    result.considered++

    const watermark = Number(row.last_digest_at || 0)
    // Drain the WHOLE since-watermark backlog (paged, gap-free) into one digest.
    const items = await collectAllDigestItems(pool, row.user_id, watermark)
    const composed = composeDigest(freq, items)

    if (composed) {
      await sendEmail({ to: row.email, subject: composed.subject, text: composed.text, html: composed.html })
      result.sent++
    } else {
      result.skipped_empty++
    }

    // Watermark → newest summarized item (overflow beyond the cap survives); on an
    // empty run → `now`. Cadence timer → always `now`.
    const newWatermark = items.length > 0 ? Math.max(watermark, items[items.length - 1].created_at) : now
    await pool.query(
      `UPDATE aaelink.user_notification_prefs
          SET last_digest_at = $1, last_digest_sent_at = $2, updated_at = $2
        WHERE user_id = $3`,
      [newWatermark, now, row.user_id]
    )
    result.watermarks_advanced++
  }

  return result
}
