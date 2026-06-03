import { randomUUID } from 'crypto'
import type { Pool } from 'pg'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server'

/**
 * WebAuthn / passkeys as an MFA factor (ADR 0016). Thin wrappers over
 * @simplewebauthn/server that own challenge + credential storage. The library
 * performs the security-critical attestation/assertion verification; this file
 * is the persistence + RP-config glue.
 */

const CHALLENGE_TTL_MS = 5 * 60_000

export type WebauthnChallengeKind = 'register' | 'authenticate'

export interface RpConfig {
  rpID: string
  rpName: string
  origin: string
}

/** Derive the Relying Party config from the public app URL. */
export function rpConfig(): RpConfig {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim() || 'http://localhost:3040'
  const url = new URL(base)
  return { rpID: url.hostname, rpName: 'AAELink', origin: url.origin }
}

interface CredentialRow {
  id: string
  credential_id: string
  public_key: string
  counter: string
  transports: string
  name: string
}

function toUint8(b64: string): Uint8Array<ArrayBuffer> {
  // Allocate a plain ArrayBuffer-backed view (not SharedArrayBuffer) so the type
  // matches @simplewebauthn's Uint8Array<ArrayBuffer> credential.publicKey.
  const buf = Buffer.from(b64, 'base64')
  const u8 = new Uint8Array(buf.length)
  u8.set(buf)
  return u8
}

function parseTransports(csv: string): AuthenticatorTransportFuture[] {
  return csv ? (csv.split(',').filter(Boolean) as AuthenticatorTransportFuture[]) : []
}

async function loadCredentials(pool: Pool, userId: string): Promise<CredentialRow[]> {
  const { rows } = await pool.query<CredentialRow>(
    `SELECT id, credential_id, public_key, counter, transports, name
       FROM aaelink.webauthn_credentials WHERE user_id = $1 ORDER BY created_at`,
    [userId]
  )
  return rows
}

async function storeChallenge(
  pool: Pool, userId: string, kind: WebauthnChallengeKind, challenge: string
): Promise<void> {
  const now = Date.now()
  // One outstanding challenge per (user, kind): clear any stale one first.
  await pool.query(
    `DELETE FROM aaelink.webauthn_challenges WHERE user_id = $1 AND kind = $2`,
    [userId, kind]
  )
  await pool.query(
    `INSERT INTO aaelink.webauthn_challenges (id, user_id, challenge, kind, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), userId, challenge, kind, now + CHALLENGE_TTL_MS, now]
  )
}

/** Read + delete the outstanding challenge for (user, kind). Null if absent/expired. */
async function consumeChallenge(
  pool: Pool, userId: string, kind: WebauthnChallengeKind
): Promise<string | null> {
  const { rows } = await pool.query<{ challenge: string; expires_at: string }>(
    `DELETE FROM aaelink.webauthn_challenges
      WHERE user_id = $1 AND kind = $2
      RETURNING challenge, expires_at`,
    [userId, kind]
  )
  const row = rows[0]
  if (!row) return null
  if (Number(row.expires_at) < Date.now()) return null
  return row.challenge
}

// ── Registration ─────────────────────────────────────────────────────

export async function beginRegistration(
  pool: Pool, userId: string, userName: string
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const { rpID, rpName } = rpConfig()
  const existing = await loadCredentials(pool, userId)
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName,
    userID: new TextEncoder().encode(userId),
    attestationType: 'none',
    excludeCredentials: existing.map(c => ({
      id: c.credential_id,
      transports: parseTransports(c.transports),
    })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  })
  await storeChallenge(pool, userId, 'register', options.challenge)
  return options
}

export async function finishRegistration(
  pool: Pool, userId: string, response: RegistrationResponseJSON, name: string
): Promise<{ verified: boolean }> {
  const expectedChallenge = await consumeChallenge(pool, userId, 'register')
  if (!expectedChallenge) throw new Error('no_registration_challenge')
  const { rpID, origin } = rpConfig()

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  })
  if (!verification.verified || !verification.registrationInfo) return { verified: false }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo
  const now = Date.now()
  await pool.query(
    `INSERT INTO aaelink.webauthn_credentials
       (id, user_id, credential_id, public_key, counter, transports, device_type, backed_up, name, created_at, last_used_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0)
     ON CONFLICT (credential_id) DO NOTHING`,
    [
      randomUUID(), userId, credential.id,
      Buffer.from(credential.publicKey).toString('base64'),
      credential.counter, (credential.transports || []).join(','),
      credentialDeviceType, credentialBackedUp, (name || 'Passkey').slice(0, 80), now,
    ]
  )
  return { verified: true }
}

// ── Authentication (MFA step-up) ─────────────────────────────────────

export async function beginAuthentication(
  pool: Pool, userId: string
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const { rpID } = rpConfig()
  const creds = await loadCredentials(pool, userId)
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: creds.map(c => ({
      id: c.credential_id,
      transports: parseTransports(c.transports),
    })),
    userVerification: 'preferred',
  })
  await storeChallenge(pool, userId, 'authenticate', options.challenge)
  return options
}

export async function finishAuthentication(
  pool: Pool, userId: string, response: AuthenticationResponseJSON
): Promise<{ verified: boolean }> {
  const expectedChallenge = await consumeChallenge(pool, userId, 'authenticate')
  if (!expectedChallenge) throw new Error('no_authentication_challenge')
  const { rpID, origin } = rpConfig()

  const { rows } = await pool.query<CredentialRow>(
    `SELECT id, credential_id, public_key, counter, transports, name
       FROM aaelink.webauthn_credentials WHERE user_id = $1 AND credential_id = $2`,
    [userId, response.id]
  )
  const cred = rows[0]
  if (!cred) return { verified: false }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
    credential: {
      id: cred.credential_id,
      publicKey: toUint8(cred.public_key),
      counter: Number(cred.counter),
      transports: parseTransports(cred.transports),
    },
  })
  if (!verification.verified) return { verified: false }

  await pool.query(
    `UPDATE aaelink.webauthn_credentials SET counter = $1, last_used_at = $2 WHERE id = $3`,
    [verification.authenticationInfo.newCounter, Date.now(), cred.id]
  )
  return { verified: true }
}

// ── Passwordless login (discoverable credential) ─────────────────────

/**
 * Begin a usernameless login: no `allowCredentials`, so the authenticator
 * offers its discoverable (resident) keys. The caller persists the returned
 * challenge (login has no session yet, so it rides a short-lived httpOnly
 * cookie) and replays it to `finishPasswordlessLogin`.
 */
export async function beginPasswordlessLogin(): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const { rpID } = rpConfig()
  return generateAuthenticationOptions({ rpID, userVerification: 'preferred' })
}

/**
 * Verify a usernameless assertion against the credential it names and, on
 * success, return the owning user id (the caller establishes the session).
 * Returns null when the credential is unknown or verification fails.
 */
export async function finishPasswordlessLogin(
  pool: Pool, response: AuthenticationResponseJSON, expectedChallenge: string
): Promise<string | null> {
  const { rpID, origin } = rpConfig()
  const { rows } = await pool.query<CredentialRow & { user_id: string }>(
    `SELECT id, user_id, credential_id, public_key, counter, transports, name
       FROM aaelink.webauthn_credentials WHERE credential_id = $1`,
    [response.id]
  )
  const cred = rows[0]
  if (!cred) return null

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
    credential: {
      id: cred.credential_id,
      publicKey: toUint8(cred.public_key),
      counter: Number(cred.counter),
      transports: parseTransports(cred.transports),
    },
  })
  if (!verification.verified) return null

  await pool.query(
    `UPDATE aaelink.webauthn_credentials SET counter = $1, last_used_at = $2 WHERE id = $3`,
    [verification.authenticationInfo.newCounter, Date.now(), cred.id]
  )
  return cred.user_id
}

// ── Management ───────────────────────────────────────────────────────

export async function listCredentials(pool: Pool, userId: string): Promise<Array<{
  id: string; name: string; device_type: string; backed_up: boolean
  created_at: number; last_used_at: number
}>> {
  const { rows } = await pool.query<{
    id: string; name: string; device_type: string; backed_up: boolean
    created_at: string; last_used_at: string
  }>(
    `SELECT id, name, device_type, backed_up, created_at, last_used_at
       FROM aaelink.webauthn_credentials WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  )
  return rows.map(r => ({
    id: r.id, name: r.name, device_type: r.device_type, backed_up: r.backed_up,
    created_at: Number(r.created_at), last_used_at: Number(r.last_used_at || 0),
  }))
}

export async function deleteCredential(pool: Pool, userId: string, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM aaelink.webauthn_credentials WHERE id = $1 AND user_id = $2`,
    [id, userId]
  )
  return Boolean(rowCount)
}

/** True when the user has at least one registered passkey. */
export async function userHasPasskey(pool: Pool, userId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM aaelink.webauthn_credentials WHERE user_id = $1 LIMIT 1`,
    [userId]
  )
  return rows.length > 0
}
