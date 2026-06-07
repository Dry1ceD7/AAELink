import type { Pool } from 'pg'

/**
 * OAuth store pruning — shared by the worker's `oauth_token_cleanup` handler.
 *
 * Extracted from lib/infra/worker.ts so the prune predicates are unit-testable
 * (the worker's `handlers` map is module-local and not exported). Both helpers
 * take a `pool` and a `now` (ms epoch) so a test can drive them deterministically.
 *
 * `expires_at` / `used_at` on aaelink.oauth_codes are BIGINT ms-epoch values
 * (see migration029); `expires_at` on aaelink.oauth_tokens uses the same
 * convention with 0 meaning "never expires".
 */

/** How long a consumed authorization code is retained before pruning (24h). */
export const CONSUMED_CODE_RETENTION_MS = 24 * 60 * 60 * 1000

/** Delete access tokens whose finite expiry has passed (expires_at > 0). */
export async function pruneExpiredOAuthTokens(pool: Pool, now: number): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM aaelink.oauth_tokens WHERE expires_at > 0 AND expires_at < $1`,
    [now]
  )
  return rowCount || 0
}

/**
 * Prune the authorization-code store: expired codes (regardless of consume
 * state) and codes consumed (used_at set) more than CONSUMED_CODE_RETENTION_MS
 * ago. Authorization codes are single-use and short-lived (10m TTL), so neither
 * expired nor long-consumed rows are ever read again by the exchange flow.
 *
 * Crucially this must NOT delete a live, unconsumed code (expires_at >= now,
 * used_at IS NULL) nor a recently consumed one (used_at within the retention
 * window) — those are still relevant to the exchange/disambiguation path.
 */
export async function pruneOAuthCodes(pool: Pool, now: number): Promise<number> {
  const consumedCutoff = now - CONSUMED_CODE_RETENTION_MS
  const { rowCount } = await pool.query(
    `DELETE FROM aaelink.oauth_codes
      WHERE expires_at < $1
         OR (used_at IS NOT NULL AND used_at < $2)`,
    [now, consumedCutoff]
  )
  return rowCount || 0
}
