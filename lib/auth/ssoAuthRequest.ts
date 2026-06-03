import { randomUUID } from 'crypto'
import type { Pool } from 'pg'

/**
 * Short-lived store for in-flight SSO authentication requests.
 *
 * Holds the OIDC state/nonce/PKCE verifier (and SAML RelayState) between the
 * `/start` redirect and the `/callback` (ACS). Rows are single-use: `consume`
 * atomically marks a row consumed and returns it only if it was still pending
 * and unexpired, which gives us CSRF protection (state binding) AND replay
 * protection (a state can be redeemed exactly once).
 */

const TTL_MS = 10 * 60 * 1000 // 10 minutes — generous for IdP round-trip

export interface SsoAuthRequest {
  id: string
  provider_id: string
  protocol: 'oidc' | 'saml'
  state: string
  nonce: string
  code_verifier: string
  relay_state: string
  redirect_uri: string
}

export interface NewAuthRequest {
  providerId: string
  protocol: 'oidc' | 'saml'
  state: string
  nonce?: string
  codeVerifier?: string
  relayState?: string
  redirectUri?: string
}

export async function createAuthRequest(
  pool: Pool,
  req: NewAuthRequest
): Promise<string> {
  const id = randomUUID()
  const now = Date.now()
  await pool.query(
    `INSERT INTO aaelink.sso_auth_requests
       (id, provider_id, protocol, state, nonce, code_verifier, relay_state,
        redirect_uri, consumed_at, expires_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10)`,
    [
      id,
      req.providerId,
      req.protocol,
      req.state,
      req.nonce ?? '',
      req.codeVerifier ?? '',
      req.relayState ?? '',
      req.redirectUri ?? '',
      now + TTL_MS,
      now,
    ]
  )
  return id
}

/**
 * Atomically redeem a pending request by its `state`. Returns null when the
 * state is unknown, already consumed, or expired — callers must treat null as a
 * hard auth failure with a generic error (no oracle distinguishing the cases).
 */
export async function consumeAuthRequest(
  pool: Pool,
  state: string
): Promise<SsoAuthRequest | null> {
  if (!state) return null
  const now = Date.now()
  const { rows } = await pool.query<SsoAuthRequest>(
    `UPDATE aaelink.sso_auth_requests
        SET consumed_at = $1
      WHERE state = $2
        AND consumed_at = 0
        AND expires_at > $1
    RETURNING id, provider_id, protocol, state, nonce, code_verifier,
              relay_state, redirect_uri`,
    [now, state]
  )
  return rows[0] ?? null
}

/** Best-effort purge of expired/consumed rows. Safe to call opportunistically. */
export async function purgeStaleAuthRequests(pool: Pool): Promise<void> {
  const cutoff = Date.now() - TTL_MS
  await pool
    .query(
      `DELETE FROM aaelink.sso_auth_requests
        WHERE expires_at < $1 OR (consumed_at > 0 AND consumed_at < $1)`,
      [cutoff]
    )
    .catch(() => { /* non-critical */ })
}
