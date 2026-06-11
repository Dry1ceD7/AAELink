/**
 * AAELink — saved-search alerts (BLUEPRINT §2.1.4: "saved searches with alerts
 * on new matches").
 *
 * The worker job 'saved_search_alerts' calls runSavedSearchAlerts() on a tick.
 * For every saved_searches row with alerts_enabled=true it:
 *   1. Re-runs the saved query through the Stage A FTS engine AS THE OWNER
 *      (uid = owner_id), so ACL is automatically correct — the alert can only
 *      ever surface messages the owner is allowed to read.
 *   2. Keeps only matches with created_at > last_match_created_at (the
 *      watermark), so a message is never alerted on twice.
 *   3. Writes ONE summary notification (kind 'saved_search') per saved search
 *      per run, carrying the match count — never one-per-message (dedup + cap).
 *   4. Advances the watermark to the newest matched created_at, and stamps
 *      last_run_at, so the next run starts after the messages we just reported.
 *
 * The query string is parsed with the same parseSearchFilters the UI uses, so
 * `from:`, `in:`, date windows, `has:`, and `is:` all behave identically to an
 * interactive search. The text portion is the FTS query; a saved search with no
 * real text (filter-only) is skipped because the engine needs >= 2 chars.
 *
 * AI/ML is out of scope — this is lexical PG FTS re-run on a schedule.
 */
import type { Pool } from 'pg'
import { searchMessages, type SearchHasFilter, type SearchEngineFilters } from '@/lib/messaging/searchEngine'
import { parseSearchFilters } from '@/lib/messaging/searchFilters'
import { insertNotifications } from '@/lib/notifications/notificationsServer'

const HAS_VALUES: SearchHasFilter[] = ['file', 'attachment', 'pin', 'reaction', 'link']
/**
 * Per-page fetch size. The engine clamps `limit` to its own MAX_LIMIT (50), so
 * a single fetch can never see more than that — we page through the backlog
 * oldest-first to cover bursts larger than one page.
 */
const PAGE_SIZE = 50
/**
 * Overall safety cap per run: at most this many backlog pages are drained in one
 * tick (so one pathologically-broad saved search can't pin the worker), giving a
 * hard ceiling of PAGE_SIZE * MAX_PAGES_PER_RUN messages reported per run. Any
 * remainder is drained on the next tick (the watermark resumes exactly where we
 * stopped — nothing is skipped).
 */
const MAX_PAGES_PER_RUN = 20

interface SavedSearchAlertRow {
  id: string
  user_id: string
  workspace_id: string
  name: string
  query: string
  last_match_created_at: string | number
}

export interface SavedSearchAlertOutcome {
  saved_search_id: string
  user_id: string
  newMatches: number
  notified: boolean
  newWatermark: number
}

/** Turn a saved query string into the engine's structured filters. */
function toEngineFilters(query: string): { text: string; filters: SearchEngineFilters } {
  const f = parseSearchFilters(query)
  const has = f.has && HAS_VALUES.includes(f.has as SearchHasFilter)
    ? [f.has as SearchHasFilter]
    : []
  const is = new Set(f.is ?? [])
  return {
    text: f.text,
    filters: {
      fromUser: f.from,
      channelName: f.in,
      before: f.before,
      after: f.after,
      on: f.on,
      during: f.during,
      has,
      isThread: is.has('thread'),
      isPinned: is.has('pinned'),
      isSaved: is.has('saved'),
    },
  }
}

/**
 * Evaluate one saved-search alert row. Returns the outcome; the caller (or this
 * function) persists the watermark. Exposed for unit/integration testing.
 */
export async function evaluateSavedSearchAlert(
  pool: Pool,
  row: SavedSearchAlertRow
): Promise<SavedSearchAlertOutcome> {
  const watermark = Number(row.last_match_created_at) || 0
  const now = Date.now()
  const { text, filters } = toEngineFilters(row.query)

  // Filter-only saved searches (no real text) can't run — the FTS engine needs
  // >= 2 chars. Treat as "no new matches" but still stamp last_run_at.
  if (text.trim().length < 2) {
    await pool.query(
      `UPDATE aaelink.saved_searches SET last_run_at = $2 WHERE id = $1`,
      [row.id, now]
    )
    return { saved_search_id: row.id, user_id: row.user_id, newMatches: 0, notified: false, newWatermark: watermark }
  }

  // Run as the owner — ACL is enforced inside the engine against this uid.
  //
  // Fix for the classic "page + advance-to-max" watermark bug: with newest-first
  // ordering + a per-fetch cap, a burst of more matches than one page would jump
  // the watermark to the absolute newest and permanently skip everything between
  // the previous watermark and the newest page. Here we page OLDEST-first using a
  // millisecond-precise moving watermark (afterMs), so each page resumes strictly
  // after the previous page's newest message — the backlog is drained in order
  // with no gaps. We loop within the run (bounded by MAX_PAGES_PER_RUN) so a
  // burst larger than one page is fully reported this tick; any overflow beyond
  // the cap resumes exactly where we stopped on the next tick.
  let cursor = watermark
  let count = 0
  let freshest: { channel_id: string; message_id: string } | undefined
  for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
    const { results } = await searchMessages(pool, {
      uid: row.user_id,
      q: text,
      workspaceId: row.workspace_id,
      filters: { ...filters, afterMs: cursor },
      scope: 'workspace',
      sort: 'oldest',
      limit: PAGE_SIZE,
    })
    if (results.length === 0) break
    count += results.length
    const last = results[results.length - 1] // newest in this oldest-first page
    cursor = last.created_at
    freshest = { channel_id: last.channel_id, message_id: last.message_id }
    if (results.length < PAGE_SIZE) break // drained
  }
  const newWatermark = cursor

  if (count === 0) {
    await pool.query(
      `UPDATE aaelink.saved_searches SET last_run_at = $2 WHERE id = $1`,
      [row.id, now]
    )
    return { saved_search_id: row.id, user_id: row.user_id, newMatches: 0, notified: false, newWatermark: watermark }
  }

  // One summary notification per saved search per run (dedup + cap).
  const title = `New matches for "${row.name}"`
  const body = count === 1
    ? `1 new message matches your saved search "${row.name}".`
    : `${count} new messages match your saved search "${row.name}".`

  await insertNotifications(pool, [{
    user_id: row.user_id,
    kind: 'saved_search',
    title,
    body,
    workspace_id: row.workspace_id,
    // Link the summary to the most-recent matching message so a click can jump
    // to it; channel_id likewise points at the freshest hit's channel.
    channel_id: freshest?.channel_id ?? null,
    message_id: freshest?.message_id ?? null,
    ticket_id: null,
  }])

  // Advance the watermark past every message we just reported and stamp the run.
  await pool.query(
    `UPDATE aaelink.saved_searches
       SET last_match_created_at = GREATEST(last_match_created_at, $2),
           last_run_at = $3
     WHERE id = $1`,
    [row.id, newWatermark, now]
  )

  return { saved_search_id: row.id, user_id: row.user_id, newMatches: count, notified: true, newWatermark }
}

/**
 * Re-run every alerts-enabled saved search and notify owners of new matches.
 * Returns one outcome per evaluated row. Safe to call repeatedly (idempotent via
 * the per-row watermark); a single failing row does not abort the batch.
 */
export async function runSavedSearchAlerts(pool: Pool): Promise<SavedSearchAlertOutcome[]> {
  const { rows } = await pool.query<SavedSearchAlertRow>(
    `SELECT id, user_id, workspace_id, name, query, last_match_created_at
       FROM aaelink.saved_searches
      WHERE alerts_enabled = true
      ORDER BY last_run_at ASC`
  )

  const outcomes: SavedSearchAlertOutcome[] = []
  for (const row of rows) {
    try {
      outcomes.push(await evaluateSavedSearchAlert(pool, row))
    } catch {
      // Don't let one broken saved search block the rest of the batch.
      outcomes.push({
        saved_search_id: row.id,
        user_id: row.user_id,
        newMatches: 0,
        notified: false,
        newWatermark: Number(row.last_match_created_at) || 0,
      })
    }
  }
  return outcomes
}
