/**
 * AAELink — FCM HTTP v1 OAuth2 access-token minting.
 *
 * Two supported credential paths, both env-only (never logged):
 *   1. FCM_ACCESS_TOKEN        — a pre-minted OAuth2 bearer (caller refreshes).
 *   2. FCM_SERVICE_ACCOUNT_JSON — a Google service-account JSON; we sign a
 *      JWT assertion (RS256, via Node `crypto` — NO new deps) and exchange it
 *      at the Google token endpoint for a short-lived bearer, then cache it.
 *
 * Returns `null` when no credential is configured, so callers can no-op
 * gracefully instead of throwing/retrying forever.
 */
import { createSign } from 'crypto'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'

interface ServiceAccount {
  client_email: string
  private_key: string
  token_uri?: string
}

let cached: { token: string; expiresAt: number } | null = null

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function parseServiceAccount(): ServiceAccount | null {
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON
  if (!raw) return null
  try {
    const sa = JSON.parse(raw) as ServiceAccount
    if (!sa.client_email || !sa.private_key) return null
    return sa
  } catch {
    return null
  }
}

function signAssertion(sa: ServiceAccount): string {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: FCM_SCOPE,
    aud: sa.token_uri || TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }))
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claim}`)
  const signature = b64url(signer.sign(sa.private_key))
  return `${header}.${claim}.${signature}`
}

/**
 * Resolve an FCM HTTP v1 bearer token, or `null` when unconfigured.
 * Caches minted tokens until ~1 min before expiry.
 */
export async function getFcmAccessToken(
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const direct = process.env.FCM_ACCESS_TOKEN
  if (direct) return direct

  const sa = parseServiceAccount()
  if (!sa) return null

  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token

  const assertion = signAssertion(sa)
  const res = await fetchImpl(sa.token_uri || TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  })
  if (!res.ok) {
    throw new Error(`fcm_token_exchange_failed:${res.status}`)
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token) throw new Error('fcm_token_exchange_no_token')

  cached = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  }
  return cached.token
}

/** Test-only: clear the cached bearer between cases. */
export function _resetFcmTokenCache(): void {
  cached = null
}
