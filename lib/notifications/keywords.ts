/**
 * D11 Notifications — keyword highlights.
 *
 * A user registers words or phrases that should notify them when they appear in
 * a message, even without a direct mention. The dispatcher runs matchKeywords
 * over a new message body against a recipient's keyword set; any hit produces a
 * highlight notification. Matching is case-insensitive and whole-word, so
 * "deploy" does not fire on "redeployment".
 */
import type { Pool } from 'pg'

const MAX_KEYWORD_LEN = 100
const MAX_KEYWORDS_PER_USER = 100

/** Normalize a keyword: trim + lowercase + collapse internal whitespace. */
export function normalizeKeyword(raw: string): string {
  return String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export type AddKeywordResult =
  | { ok: true; keyword: string }
  | { ok: false; code: 'invalid' | 'too_long' | 'limit_reached' }

/** Add a keyword for a user (idempotent). */
export async function addKeyword(pool: Pool, uid: string, raw: string): Promise<AddKeywordResult> {
  const keyword = normalizeKeyword(raw)
  if (!keyword) return { ok: false, code: 'invalid' }
  if (keyword.length > MAX_KEYWORD_LEN) return { ok: false, code: 'too_long' }

  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM aaelink.notification_keywords WHERE user_id = $1`,
    [uid]
  )
  // Allow the insert if the keyword already exists (idempotent); only block new
  // keywords once the cap is reached.
  if (Number(rows[0]?.n ?? 0) >= MAX_KEYWORDS_PER_USER) {
    const { rows: exists } = await pool.query(
      `SELECT 1 FROM aaelink.notification_keywords WHERE user_id = $1 AND keyword = $2`,
      [uid, keyword]
    )
    if (exists.length === 0) return { ok: false, code: 'limit_reached' }
  }

  await pool.query(
    `INSERT INTO aaelink.notification_keywords (user_id, keyword, created_at)
     VALUES ($1, $2, $3) ON CONFLICT (user_id, keyword) DO NOTHING`,
    [uid, keyword, Date.now()]
  )
  return { ok: true, keyword }
}

/** Remove a keyword. False when the user had no such keyword. */
export async function removeKeyword(pool: Pool, uid: string, raw: string): Promise<boolean> {
  const keyword = normalizeKeyword(raw)
  const { rowCount } = await pool.query(
    `DELETE FROM aaelink.notification_keywords WHERE user_id = $1 AND keyword = $2`,
    [uid, keyword]
  )
  return (rowCount ?? 0) > 0
}

/** A user's keywords, alphabetical. */
export async function listKeywords(pool: Pool, uid: string): Promise<string[]> {
  const { rows } = await pool.query<{ keyword: string }>(
    `SELECT keyword FROM aaelink.notification_keywords WHERE user_id = $1 ORDER BY keyword ASC`,
    [uid]
  )
  return rows.map(r => r.keyword)
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Which of `keywords` appear as whole words in `text` (case-insensitive). Pure —
 * the dispatcher calls this per recipient. Returns the matched keywords.
 */
export function matchKeywords(text: string, keywords: string[]): string[] {
  const body = String(text || '')
  if (!body || !keywords.length) return []
  const hits: string[] = []
  for (const kw of keywords) {
    const k = normalizeKeyword(kw)
    if (!k) continue
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegex(k)}(?![\\p{L}\\p{N}_])`, 'iu')
    if (re.test(body)) hits.push(k)
  }
  return hits
}
