/**
 * Unit tests for migration 031_entra_to_sso_providers.
 *
 * Drives the migration body directly against a stub RunnerPool (same pattern as
 * tests/migrationRunner.test.ts) — no live Postgres. We assert the decision
 * logic and the EXACT secret-storage shape the hardened RP loader expects:
 *   - skip when aaelink.sso_configs is absent (fresh DB)
 *   - skip when an active OIDC/oauth2 provider already exists
 *   - skip when no secret-encryption key is configured (no broken row)
 *   - seed a 'Microsoft Entra ID' OIDC provider with the canonical discovery URL
 *     and an AES-256-GCM-encrypted client_secret_enc that decrypts back to the
 *     plaintext, plus the sha256:… display hash the admin POST writes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { migration031EntraToSsoProviders } from '@/lib/infra/migrate'
import { decryptSecret } from '@/lib/auth/ssoSecretCrypto'
import type { RunnerPool } from '@/lib/infra/migrationRunner'

interface Recorded { text: string; params?: unknown[] }

interface StubOpts {
  /** aaelink.sso_configs present? */
  hasConfigsTable?: boolean
  /** an active oidc/oauth2 provider already exists? */
  hasActiveOidc?: boolean
  /** the enabled entra config row to return, or null for none */
  entraRow?: { tenant_id?: string; client_id?: string; client_secret?: string } | null
}

function makePool(opts: StubOpts) {
  const inserts: Recorded[] = []
  const all: Recorded[] = []
  const pool: RunnerPool = {
    async query(text: string, params?: unknown[]) {
      all.push({ text, params })
      if (/to_regclass\('aaelink\.sso_configs'\)/i.test(text)) {
        return { rows: [{ exists: opts.hasConfigsTable ? 'aaelink.sso_configs' : null }] }
      }
      if (/SELECT 1 FROM aaelink\.sso_providers/i.test(text)) {
        return { rows: opts.hasActiveOidc ? [{ '?column?': 1 }] : [] }
      }
      if (/FROM aaelink\.sso_configs\s+WHERE provider = 'entra'/i.test(text)) {
        return { rows: opts.entraRow ? [opts.entraRow] : [] }
      }
      if (/INSERT INTO aaelink\.sso_providers/i.test(text)) {
        inserts.push({ text, params })
        return { rows: [] }
      }
      return { rows: [] }
    },
  }
  return { pool, inserts, all }
}

const PRIOR_KEY = process.env.AAELINK_SSO_SECRET_KEY
const PRIOR_SESSION = process.env.AAELINK_SESSION_SECRET

beforeEach(() => {
  process.env.AAELINK_SSO_SECRET_KEY = 'unit-test-sso-key-please-rotate'
  delete process.env.AAELINK_SESSION_SECRET
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  if (PRIOR_KEY === undefined) delete process.env.AAELINK_SSO_SECRET_KEY
  else process.env.AAELINK_SSO_SECRET_KEY = PRIOR_KEY
  if (PRIOR_SESSION === undefined) delete process.env.AAELINK_SESSION_SECRET
  else process.env.AAELINK_SESSION_SECRET = PRIOR_SESSION
  vi.restoreAllMocks()
})

describe('migration031EntraToSsoProviders', () => {
  it('is a no-op when sso_configs does not exist (fresh DB)', async () => {
    const { pool, inserts } = makePool({ hasConfigsTable: false })
    await migration031EntraToSsoProviders(pool)
    expect(inserts).toHaveLength(0)
  })

  it('does not seed when an active OIDC provider already exists', async () => {
    const { pool, inserts } = makePool({
      hasConfigsTable: true,
      hasActiveOidc: true,
      entraRow: { tenant_id: 't', client_id: 'c', client_secret: 's' },
    })
    await migration031EntraToSsoProviders(pool)
    expect(inserts).toHaveLength(0)
  })

  it('does not seed when there is no enabled entra config row', async () => {
    const { pool, inserts } = makePool({
      hasConfigsTable: true,
      hasActiveOidc: false,
      entraRow: null,
    })
    await migration031EntraToSsoProviders(pool)
    expect(inserts).toHaveLength(0)
  })

  it('skips (does not seed a broken row) when no secret-encryption key is set', async () => {
    delete process.env.AAELINK_SSO_SECRET_KEY
    delete process.env.AAELINK_SESSION_SECRET
    const { pool, inserts } = makePool({
      hasConfigsTable: true,
      hasActiveOidc: false,
      entraRow: { tenant_id: 'tenant-123', client_id: 'cid', client_secret: 'topsecret' },
    })
    await migration031EntraToSsoProviders(pool)
    expect(inserts).toHaveLength(0)
  })

  it('does not seed when the legacy entra config is incomplete', async () => {
    const { pool, inserts } = makePool({
      hasConfigsTable: true,
      hasActiveOidc: false,
      entraRow: { tenant_id: 'tenant-123', client_id: '', client_secret: 'topsecret' },
    })
    await migration031EntraToSsoProviders(pool)
    expect(inserts).toHaveLength(0)
  })

  it('seeds an Entra OIDC provider with canonical discovery URL and recoverable secret', async () => {
    const { pool, inserts } = makePool({
      hasConfigsTable: true,
      hasActiveOidc: false,
      entraRow: { tenant_id: 'tenant-123', client_id: 'app-id-abc', client_secret: 'topsecret-value' },
    })
    await migration031EntraToSsoProviders(pool)
    expect(inserts).toHaveLength(1)

    const params = inserts[0].params as unknown[]
    // VALUES order: $1 id, $2 name, $3 discovery_url, $4 client_id,
    //   $5 client_secret_hash, $6 client_secret_enc, $7 callback_url,
    //   $8 attribute_mapping, $9 created_at/updated_at
    const [id, name, discoveryUrl, clientId, secretHash, secretEnc, callbackUrl, attrMap] = params

    expect(name).toBe('Microsoft Entra ID')
    expect(discoveryUrl).toBe(
      'https://login.microsoftonline.com/tenant-123/v2.0/.well-known/openid-configuration'
    )
    expect(clientId).toBe('app-id-abc')
    // Non-recoverable display hash mirrors the /api/auth/sso POST exactly.
    expect(secretHash).toBe('sha256:topsecre***')
    // Recoverable ciphertext must decrypt back to the original secret so the RP
    // code exchange (loadActiveProvider → decryptSecret) works.
    expect(typeof secretEnc).toBe('string')
    expect(secretEnc).not.toBe('')
    expect(decryptSecret(secretEnc as string)).toBe('topsecret-value')
    // Callback URL binds to the freshly minted provider id (hardened RP path).
    expect(callbackUrl).toBe(`/api/auth/sso/oidc/callback?provider=${id}`)
    // attribute_mapping is the same JSON default the admin POST persists.
    expect(JSON.parse(attrMap as string)).toEqual({ email: 'email', name: 'name', groups: 'groups' })
  })
})
