import { createHmac } from 'crypto'

/**
 * Ephemeral TURN credentials (coturn "TURN REST API" / time-limited long-term
 * credentials). A WebRTC client needs short-lived TURN auth to relay media
 * through NAT; the control plane (call_rooms / signals) was complete but TURN
 * creds were never minted, so the username/credential in the calls config were
 * empty stubs.
 *
 * Credential model (env-only, matches coturn `use-auth-secret`):
 *   - TURN_STATIC_AUTH_SECRET — shared secret with coturn (`static-auth-secret`)
 *   - TURN_URLS               — csv of turn:/turns: URIs
 *   - STUN_URLS               — csv of stun: URIs
 *   - TURN_CRED_TTL_SEC       — credential lifetime (default 12h)
 *
 * username   = "<unix-expiry>:<userId>"   (coturn reads the leading timestamp)
 * credential = base64( HMAC-SHA1( secret, username ) )
 *
 * GRACEFUL NO-OP: with no shared secret we return STUN only and never fabricate
 * a TURN credential that coturn would reject.
 */

const DEFAULT_TTL_SEC = 12 * 3600
const DEFAULT_TURN_URLS = ['turn:turn.aaelink.local:3478']
const DEFAULT_STUN_URLS = ['stun:stun.l.google.com:19302']

export interface IceServer {
  urls: string | string[]
  username?: string
  credential?: string
}

export interface TurnCredentials {
  username: string
  credential: string
  ttl: number
  expiresAt: number
}

function csv(value: string | undefined, fallback: string[]): string[] {
  const parts = (value || '').split(',').map(s => s.trim()).filter(Boolean)
  return parts.length ? parts : fallback
}

/** True when a TURN shared secret is configured. */
export function turnConfigured(): boolean {
  return Boolean(process.env.TURN_STATIC_AUTH_SECRET)
}

/**
 * Mint an ephemeral TURN credential for `userId`. Returns null when no shared
 * secret is configured (STUN-only deployment).
 */
export function issueTurnCredentials(userId: string, now: number = Date.now()): TurnCredentials | null {
  const secret = process.env.TURN_STATIC_AUTH_SECRET || ''
  if (!secret) return null
  const ttl = Math.max(60, Number(process.env.TURN_CRED_TTL_SEC) || DEFAULT_TTL_SEC)
  const expiresAt = Math.floor(now / 1000) + ttl
  const username = `${expiresAt}:${userId}`
  const credential = createHmac('sha1', secret).update(username).digest('base64')
  return { username, credential, ttl, expiresAt }
}

/**
 * Build the RTCPeerConnection `iceServers` list for `userId`: always the STUN
 * servers, plus a TURN entry with fresh ephemeral creds when configured.
 */
export function iceServersFor(
  userId: string, now: number = Date.now()
): { iceServers: IceServer[]; turn: boolean; expiresAt: number } {
  const servers: IceServer[] = [{ urls: csv(process.env.STUN_URLS, DEFAULT_STUN_URLS) }]
  const creds = issueTurnCredentials(userId, now)
  if (creds) {
    servers.push({
      urls: csv(process.env.TURN_URLS, DEFAULT_TURN_URLS),
      username: creds.username,
      credential: creds.credential,
    })
  }
  return { iceServers: servers, turn: Boolean(creds), expiresAt: creds?.expiresAt ?? 0 }
}
