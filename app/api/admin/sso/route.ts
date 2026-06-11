import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { randomUUID } from 'crypto'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { encryptSecret, ssoSecretKeyConfigured } from '@/lib/auth/ssoSecretCrypto'

/**
 * Legacy Entra admin panel API.
 *
 * This panel predates the hardened inbound-SSO RP stack (ADR 0014). The login
 * flow no longer reads aaelink.sso_configs — it reads the OIDC provider row in
 * aaelink.sso_providers (loadActiveProvider → decryptSecret). To prevent a
 * silent-auth-break where an admin rotates the Entra secret here but the RP flow
 * keeps decrypting the stale secret from sso_providers, this route is now a thin
 * write-THROUGH editor: every POST mirrors the credentials into the canonical
 * 'Microsoft Entra ID' OIDC provider the login flow actually uses (re-encrypting
 * the client secret exactly as POST /api/auth/sso does). sso_configs is retained
 * only as the panel's display store.
 */

/** Canonical name for the Entra-backed OIDC provider row (matches migration 031). */
const ENTRA_PROVIDER_NAME = 'Microsoft Entra ID'

function entraDiscoveryUrl(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}/v2.0/.well-known/openid-configuration`
}

async function _GET(req: NextRequest) {
  try {
    await ensureSchema()
    const userId = await readSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const pool = getPool()
    if (!pool) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 })

    const userRes = await pool.query(`SELECT platform_role FROM aaelink.users WHERE id = $1`, [userId])
    if (!userRes.rows[0] || !isPlatformAdmin(userRes.rows[0].platform_role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const ssoRes = await pool.query(`SELECT * FROM aaelink.sso_configs WHERE provider = 'entra'`)
    const config = ssoRes.rows[0] || null

    // Surface the id of the OIDC provider the login flow actually reads so the
    // admin panel can render the REAL callback URL
    // (/api/auth/sso/oidc/callback?provider=<id>) instead of the retired
    // /api/auth/entra shim, which is not a valid OAuth redirect target.
    const provRes = await pool.query<{ id: string }>(
      `SELECT id FROM aaelink.sso_providers
        WHERE name = $1 AND type IN ('oidc', 'oauth2')
        ORDER BY is_active DESC, created_at DESC
        LIMIT 1`,
      [ENTRA_PROVIDER_NAME]
    )
    const providerId = provRes.rows[0]?.id || ''

    return NextResponse.json({ config, provider_id: providerId })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'sso_query_failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function _POST(req: NextRequest) {
  try {
    await ensureSchema()
    const userId = await readSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const pool = getPool()
    if (!pool) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 })

    const userRes = await pool.query(`SELECT platform_role FROM aaelink.users WHERE id = $1`, [userId])
    if (!userRes.rows[0] || !isPlatformAdmin(userRes.rows[0].platform_role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { tenant_id, client_id, client_secret, is_enabled } = await req.json()
    if (!tenant_id || !client_id || !client_secret) {
      return NextResponse.json({ error: 'missing_required_fields' }, { status: 400 })
    }

    // The login flow reads the recoverable client_secret_enc from sso_providers,
    // so a write here MUST be re-encryptable — otherwise the rotated secret would
    // never reach the path that actually performs the code exchange. Fail loudly
    // (503) rather than silently leave SSO decrypting the stale secret.
    if (!ssoSecretKeyConfigured()) {
      return NextResponse.json({ error: 'sso_secret_key_unconfigured' }, { status: 503 })
    }

    const enabled = is_enabled ? true : false
    const id = randomUUID()
    const now = Date.now()

    // 1) Display store (legacy panel state).
    await pool.query(`
      INSERT INTO aaelink.sso_configs (id, provider, tenant_id, client_id, client_secret, is_enabled, updated_at)
      VALUES ($1, 'entra', $2, $3, $4, $5, $6)
      ON CONFLICT (provider) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        client_id = EXCLUDED.client_id,
        client_secret = EXCLUDED.client_secret,
        is_enabled = EXCLUDED.is_enabled,
        updated_at = EXCLUDED.updated_at
    `, [id, tenant_id, client_id, client_secret, enabled, now])

    // 2) Write-THROUGH to the canonical OIDC provider the login flow reads. This
    //    keeps the legacy panel a thin editor over aaelink.sso_providers so a
    //    secret rotation here can never diverge from what the RP code exchange
    //    decrypts. Mirror the /api/auth/sso POST persistence exactly: a
    //    non-recoverable display hash plus the AES-256-GCM ciphertext.
    const discoveryUrl = entraDiscoveryUrl(String(tenant_id).trim())
    const secretEnc = encryptSecret(String(client_secret))
    const secretHash = `sha256:${String(client_secret).slice(0, 8)}***`
    const attributeMapping = JSON.stringify({ email: 'email', name: 'name', groups: 'groups' })

    const existingProv = await pool.query<{ id: string }>(
      `SELECT id FROM aaelink.sso_providers
        WHERE name = $1 AND type IN ('oidc', 'oauth2')
        ORDER BY is_active DESC, created_at DESC
        LIMIT 1`,
      [ENTRA_PROVIDER_NAME]
    )
    const provId = existingProv.rows[0]?.id || randomUUID()

    if (existingProv.rows[0]) {
      await pool.query(`
        UPDATE aaelink.sso_providers SET
          type = 'oidc',
          discovery_url = $2,
          client_id = $3,
          client_secret_hash = $4,
          client_secret_enc = $5,
          callback_url = $6,
          is_active = $7,
          updated_at = $8
        WHERE id = $1
      `, [
        provId,
        discoveryUrl,
        String(client_id),
        secretHash,
        secretEnc,
        `/api/auth/sso/oidc/callback?provider=${provId}`,
        enabled,
        now,
      ])
    } else {
      await pool.query(`
        INSERT INTO aaelink.sso_providers
          (id, name, type, issuer, metadata_url, discovery_url,
           client_id, client_secret_hash, client_secret_enc, callback_url, scopes,
           jit_provisioning, default_role, default_workspace_id,
           attribute_mapping, group_role_mapping,
           saml_entry_point, saml_idp_cert, saml_idp_certs, saml_audience,
           session_lifetime_hours, enforce_mfa, is_active,
           login_count, last_login_at, created_by, created_at, updated_at)
        VALUES ($1, $2, 'oidc', '', '', $3,
                $4, $5, $6, $7, 'openid profile email',
                true, 'member', NULL,
                $8, '{}',
                '', '', '[]', '',
                24, false, $9,
                0, 0, $10, $11, $11)
      `, [
        provId,
        ENTRA_PROVIDER_NAME,
        discoveryUrl,
        String(client_id),
        secretHash,
        secretEnc,
        `/api/auth/sso/oidc/callback?provider=${provId}`,
        attributeMapping,
        enabled,
        userId,
        now,
      ])
    }

    const ipAddress = req.headers.get('x-forwarded-for') || '127.0.0.1'
    const userAgent = req.headers.get('user-agent') || ''
    await pool.query(`
      INSERT INTO aaelink.audit_log (id, actor_id, actor_role, action, resource_kind, resource_id, ip_address, user_agent, metadata, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      randomUUID(),
      userId,
      userRes.rows[0].platform_role,
      'sso_config_update',
      'sso_config',
      'entra',
      ipAddress,
      userAgent,
      JSON.stringify({ tenant_id, client_id, is_enabled: enabled, provider_id: provId }),
      now
    ])

    return NextResponse.json({ success: true, provider_id: provId })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'sso_update_failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/sso', _GET)
export const POST   = tracedRoute('POST', '/api/admin/sso', _POST)
