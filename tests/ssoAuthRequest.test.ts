/**
 * AAELink — SSO auth-request store: single-use state/nonce/RelayState binding.
 *
 * Uses a tiny in-memory fake of the subset of pg.Pool the module touches, so we
 * exercise the real consume() logic (CSRF + replay protection) without Postgres.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { Pool } from 'pg'
import { createAuthRequest, consumeAuthRequest } from '@/lib/auth/ssoAuthRequest'

interface Row {
  id: string; provider_id: string; protocol: string; state: string
  nonce: string; code_verifier: string; relay_state: string; redirect_uri: string
  consumed_at: number; expires_at: number; created_at: number
}

function fakePool(rows: Row[]): Pool {
  return {
    query: async (text: string, params: unknown[] = []) => {
      if (text.includes('INSERT INTO aaelink.sso_auth_requests')) {
        rows.push({
          id: params[0] as string, provider_id: params[1] as string,
          protocol: params[2] as string, state: params[3] as string,
          nonce: params[4] as string, code_verifier: params[5] as string,
          relay_state: params[6] as string, redirect_uri: params[7] as string,
          consumed_at: 0, expires_at: params[8] as number, created_at: params[9] as number,
        })
        return { rows: [] }
      }
      if (text.includes('UPDATE aaelink.sso_auth_requests')) {
        const now = params[0] as number
        const state = params[1] as string
        const r = rows.find(x => x.state === state && x.consumed_at === 0 && x.expires_at > now)
        if (!r) return { rows: [] }
        r.consumed_at = now
        return { rows: [{ ...r }] }
      }
      return { rows: [] }
    },
  } as unknown as Pool
}

describe('ssoAuthRequest', () => {
  let rows: Row[]
  let pool: Pool
  beforeEach(() => { rows = []; pool = fakePool(rows) })

  it('creates then consumes exactly once (replay protection)', async () => {
    await createAuthRequest(pool, { providerId: 'p1', protocol: 'oidc', state: 'st-1', nonce: 'n', codeVerifier: 'v' })
    const first = await consumeAuthRequest(pool, 'st-1')
    expect(first).not.toBeNull()
    expect(first!.provider_id).toBe('p1')
    expect(first!.nonce).toBe('n')
    const second = await consumeAuthRequest(pool, 'st-1')
    expect(second).toBeNull() // already consumed
  })

  it('returns null for an unknown state (CSRF defense)', async () => {
    await createAuthRequest(pool, { providerId: 'p1', protocol: 'oidc', state: 'st-1' })
    expect(await consumeAuthRequest(pool, 'forged-state')).toBeNull()
  })

  it('returns null for an empty state', async () => {
    expect(await consumeAuthRequest(pool, '')).toBeNull()
  })

  it('returns null when the request is expired', async () => {
    rows.push({
      id: 'a', provider_id: 'p1', protocol: 'oidc', state: 'old', nonce: '', code_verifier: '',
      relay_state: '', redirect_uri: '', consumed_at: 0,
      expires_at: Date.now() - 1000, created_at: Date.now() - 2000,
    })
    expect(await consumeAuthRequest(pool, 'old')).toBeNull()
  })

  it('carries SAML RelayState through', async () => {
    await createAuthRequest(pool, { providerId: 'p2', protocol: 'saml', state: 'rs-9', relayState: 'rs-9' })
    const got = await consumeAuthRequest(pool, 'rs-9')
    expect(got!.protocol).toBe('saml')
    expect(got!.relay_state).toBe('rs-9')
  })
})
