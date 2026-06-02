/**
 * AAELink — Search filter token parser.
 *
 * Turns a free-form query like
 *   "deploy from:alice has:link before:2025-01-01"
 * into a structured `SearchFilters` object suitable for building
 * the `/api/search/messages?…` URL search params.
 *
 * Supported tokens (matching the keys the route already accepts in
 * `app/api/search/messages/route.ts`):
 *   - from:<username>
 *   - in:<channel-id-or-name>
 *   - before:<YYYY-MM-DD>
 *   - after:<YYYY-MM-DD>
 *   - has:<link|file|attachment|pin|reaction>
 *
 * Anything not matching the `<key>:<value>` shape is left in the
 * `text` field, which is the actual `q` parameter the route uses for
 * its `ILIKE` body match.
 *
 * The parser intentionally:
 *   - Treats keys as case-insensitive (`FROM:alice` → `from: 'alice'`).
 *   - Leaves the `<value>` exactly as the user typed it (case-sensitive),
 *     because usernames, channel ids, and `has:` keywords are handled
 *     server-side and we don't want to surprise users with silent
 *     transformations.
 *   - Rejects malformed `<key>:` (no value) — the colon stays in the
 *     free-text portion. This mirrors the behavior of Slack's parser.
 */

export interface SearchFilters {
  text: string
  from?: string
  in?: string
  before?: string
  after?: string
  has?: string
}

const FILTER_RE = /\b(from|in|before|after|has):(\S+)/gi

/**
 * Parse a search query string into structured filters + free text.
 *
 * The regex requires a non-empty `\S+` value so a bare `from:` (no
 * value) is left in the text portion as-is.
 *
 * @param raw — the raw query string from the search input
 * @returns structured `SearchFilters` (always with a `text` field)
 */
export function parseSearchFilters(raw: string): SearchFilters {
  const filters: SearchFilters = { text: '' }
  let text = raw

  for (const match of raw.matchAll(FILTER_RE)) {
    const key = match[1].toLowerCase() as keyof Omit<SearchFilters, 'text'>
    filters[key] = match[2]
    // Strip the matched token from the text view. Use a literal replace
    // (not regex) so user-supplied special chars (% / etc.) inside the
    // value can never break the strip.
    text = text.replace(match[0], '')
  }

  filters.text = text.replace(/\s+/g, ' ').trim()
  return filters
}

/** YYYY-MM-DD — matches the same shape the search route validates. */
export function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

/**
 * `has:` keyword whitelist — the server-side route only knows how to
 * filter on this set. Other values would silently no-op server-side, so
 * the UI should warn before sending them.
 */
const HAS_VALUES = new Set(['link', 'file', 'attachment', 'pin', 'reaction'])

export function validateHasValue(s: string): boolean {
  return HAS_VALUES.has(s)
}

/** Filter keys recognized by `parseSearchFilters`. */
export type FilterKey = 'from' | 'in' | 'before' | 'after' | 'has'

/**
 * Strip the first `<key>:<value>` token (case-insensitive on the key)
 * from a raw query string and return the cleaned-up free-text version.
 *
 * Used by the `<SearchFilters>` chip primitive to produce the new query
 * after a user clicks "remove" on a chip.
 *
 * Behavior pinned by tests in `tests/searchFiltersChip.test.ts`:
 *   - Whitespace around the removed token is collapsed/trimmed.
 *   - Only the *first* occurrence of `<key>:` is removed; trailing copies
 *     stay (so a user with two `from:` chips can remove them one at a time).
 *   - Returns the original string if no match.
 */
export function removeFilterToken(raw: string, key: FilterKey): string {
  // Build a regex that matches "<key>:<non-space>" with case-insensitive
  // key. The leading `\b` keeps it from matching an internal substring.
  const re = new RegExp(`\\b${key}:\\S+`, 'i')
  const match = re.exec(raw)
  if (!match) return raw
  const before = raw.slice(0, match.index)
  const after = raw.slice(match.index + match[0].length)
  return `${before}${after}`.replace(/\s+/g, ' ').trim()
}

/**
 * Build the chip label text shown in the UI for a given filter.
 *
 * Date filters use a single-space separator (`before 2025-01-01`) because
 * the leading colon reads strangely with a date. Identifier filters use
 * the colon form (`from: alice`) because that mirrors the original token
 * the user typed.
 */
export function formatFilterChip(key: FilterKey, value: string): string {
  if (key === 'before' || key === 'after') return `${key} ${value}`
  return `${key}: ${value}`
}
