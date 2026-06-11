import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { encryptSecret, ssoSecretKeyConfigured } from '@/lib/auth/ssoSecretCrypto'
import { fetchSamlIdpMetadata } from '@/lib/auth/samlMetadata'

/**
 * SSO Configuration API — manage SAML/OIDC identity provider settings.
 *
 * GET  /api/auth/sso — list configured SSO providers
 * POST /api/auth/sso — register a new SSO identity provider
 * PUT  /api/auth/sso — update SSO provider settings
 *
 * Supported providers:
 *   - saml   — SAML 2.0 (Okta, Azure AD, ADFS, OneLogin)
 *   - oidc   — OpenID Connect (Google, Azure, Keycloak, Auth0)
 *   - oauth2 — Generic OAuth2 (GitHub, GitLab, custom)
 *
 * Configuration includes:
 *   - Metadata URL / XML (SAML)
 *   - Discovery URL / client credentials (OIDC)
 *   - Attribute mapping (email, name, groups, roles)
 *   - JIT provisioning (auto-create users on first login)
 *   - Group-to-role mapping (IDP groups → platform roles)
 *   - Session lifetime overrides
 *   - MFA enforcement on SSO sessions
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { rows } = await pool.query(`
    SELECT id, name, type, issuer, metadata_url, discovery_url,
           client_id, jit_provisioning, default_role, group_role_mapping,
           is_active, last_login_at, login_count, created_at, updated_at
    FROM aaelink.sso_providers
    ORDER BY created_at DESC
  `)

  return NextResponse.json({
    providers: rows.map(p => ({
      ...p,
      created_at: Number(p.created_at),
      updated_at: Number(p.updated_at || 0),
      last_login_at: Number(p.last_login_at || 0),
      login_count: Number(p.login_count || 0),
    }))
  })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (uRows[0]?.platform_role !== 'super_admin') {
    return NextResponse.json({ error: 'super_admin_only' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: string; type?: string
    issuer?: string; metadata_url?: string; discovery_url?: string
    client_id?: string; client_secret?: string; scopes?: string
    callback_url?: string
    jit_provisioning?: boolean; default_role?: string; default_workspace_id?: string
    attribute_mapping?: Record<string, string>
    group_role_mapping?: Record<string, string>
    session_lifetime_hours?: number; enforce_mfa?: boolean
    saml_entry_point?: string; saml_idp_cert?: string; saml_audience?: string
  }

  const name = String(body.name || '').trim()
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })

  const VALID_TYPES = ['saml', 'oidc', 'oauth2']
  const type = VALID_TYPES.includes(body.type || '') ? body.type! : 'oidc'

  // Validate type-specific requirements.
  // SAML can be configured EITHER via an IdP metadata_url (auto-discovers the
  // entry point + signing cert) OR via explicit saml_entry_point + saml_idp_cert.
  // Only require the explicit pair when no metadata_url was supplied.
  if (type === 'saml' && !body.metadata_url) {
    if (!body.saml_entry_point) {
      return NextResponse.json({ error: 'saml_entry_point_required' }, { status: 400 })
    }
    if (!body.saml_idp_cert) {
      return NextResponse.json({ error: 'saml_idp_cert_required' }, { status: 400 })
    }
  }
  if ((type === 'oidc' || type === 'oauth2') && (!body.client_id || !body.client_secret)) {
    return NextResponse.json({ error: 'client_id_and_client_secret_required' }, { status: 400 })
  }
  if ((type === 'oidc' || type === 'oauth2') && !body.issuer && !body.discovery_url) {
    return NextResponse.json({ error: 'issuer_or_discovery_url_required' }, { status: 400 })
  }
  // We only persist a recoverable (AES-256-GCM) client secret when one is
  // actually supplied. The secret-encryption key is therefore only required when
  // there is a secret to encrypt — otherwise providers without a stored secret
  // (SAML, or metadata-only config) must still save as before.
  if (body.client_secret && !ssoSecretKeyConfigured()) {
    return NextResponse.json({ error: 'sso_secret_key_unconfigured' }, { status: 503 })
  }

  const id = randomUUID()
  const now = Date.now()
  // Store BOTH a non-recoverable hash (legacy display) and a recoverable,
  // AES-256-GCM ciphertext used by the RP code exchange. Never the plaintext.
  const secretEnc = body.client_secret ? encryptSecret(body.client_secret) : ''

  // SAML metadata auto-discovery: when an IdP metadata_url is supplied, fetch +
  // parse it to fill the entry point + signing cert set (ADR 0015). Explicit
  // values still win for the single-cert/entry-point fields if also provided.
  let samlEntryPoint = body.saml_entry_point || ''
  let samlIdpCert = body.saml_idp_cert || ''
  let samlIdpCerts: string[] = []
  let resolvedIssuer = body.issuer || ''
  if (type === 'saml' && body.metadata_url) {
    try {
      const md = await fetchSamlIdpMetadata(body.metadata_url)
      samlEntryPoint = samlEntryPoint || md.entryPoint
      samlIdpCerts = md.certs
      samlIdpCert = samlIdpCert || md.certs[0] || ''
      resolvedIssuer = resolvedIssuer || md.entityId
    } catch {
      return NextResponse.json({ error: 'saml_metadata_fetch_failed' }, { status: 400 })
    }
  }

  await pool.query(`
    INSERT INTO aaelink.sso_providers
      (id, name, type, issuer, metadata_url, discovery_url,
       client_id, client_secret_hash, client_secret_enc, callback_url, scopes,
       jit_provisioning, default_role, default_workspace_id,
       attribute_mapping, group_role_mapping,
       saml_entry_point, saml_idp_cert, saml_idp_certs, saml_audience,
       session_lifetime_hours, enforce_mfa, is_active,
       login_count, last_login_at, created_by, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
            $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, true,
            0, 0, $23, $24, $24)
  `, [
    id, name, type,
    resolvedIssuer, body.metadata_url || '', body.discovery_url || '',
    body.client_id || '', body.client_secret ? `sha256:${body.client_secret.slice(0, 8)}***` : '',
    secretEnc,
    body.callback_url || `/api/auth/sso/callback/${id}`,
    body.scopes || 'openid profile email',
    body.jit_provisioning !== false, body.default_role || 'member',
    body.default_workspace_id || null,
    JSON.stringify(body.attribute_mapping || { email: 'email', name: 'name', groups: 'groups' }),
    JSON.stringify(body.group_role_mapping || {}),
    samlEntryPoint, samlIdpCert, JSON.stringify(samlIdpCerts), body.saml_audience || '',
    Math.min(Math.max(body.session_lifetime_hours || 24, 1), 720),
    body.enforce_mfa || false,
    uid, now
  ])

  await pool.query(`
    INSERT INTO aaelink.audit_log (id, actor_id, action, resource_kind, resource_id, metadata, created_at)
    VALUES ($1, $2, 'sso_provider_created', 'sso', $3, $4, $5)
  `, [randomUUID(), uid, id, JSON.stringify({ name, type }), now])

  return NextResponse.json({
    provider: {
      id, name, type, is_active: true,
      callback_url: `/api/auth/sso/callback/${id}`,
      created_at: now
    }
  }, { status: 201 })
}

async function _PUT(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (uRows[0]?.platform_role !== 'super_admin') {
    return NextResponse.json({ error: 'super_admin_only' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    provider_id?: string; is_active?: boolean
    jit_provisioning?: boolean; default_role?: string
    group_role_mapping?: Record<string, string>
    session_lifetime_hours?: number; enforce_mfa?: boolean
  }

  const provId = String(body.provider_id || '').trim()
  if (!provId) return NextResponse.json({ error: 'provider_id_required' }, { status: 400 })

  const updates: string[] = []
  const params: unknown[] = []

  if (body.is_active !== undefined) { params.push(body.is_active); updates.push(`is_active = $${params.length}`) }
  if (body.jit_provisioning !== undefined) { params.push(body.jit_provisioning); updates.push(`jit_provisioning = $${params.length}`) }
  if (body.default_role) { params.push(body.default_role); updates.push(`default_role = $${params.length}`) }
  if (body.group_role_mapping) { params.push(JSON.stringify(body.group_role_mapping)); updates.push(`group_role_mapping = $${params.length}`) }
  if (body.session_lifetime_hours) { params.push(body.session_lifetime_hours); updates.push(`session_lifetime_hours = $${params.length}`) }
  if (body.enforce_mfa !== undefined) { params.push(body.enforce_mfa); updates.push(`enforce_mfa = $${params.length}`) }

  if (updates.length === 0) return NextResponse.json({ error: 'no_updates' }, { status: 400 })

  params.push(Date.now()); updates.push(`updated_at = $${params.length}`)
  params.push(provId)

  const { rowCount } = await pool.query(
    `UPDATE aaelink.sso_providers SET ${updates.join(', ')} WHERE id = $${params.length}`,
    params
  )
  if (!rowCount) return NextResponse.json({ error: 'provider_not_found' }, { status: 404 })

  return NextResponse.json({ ok: true, updated: provId })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/auth/sso', _GET)
export const POST   = tracedRoute('POST', '/api/auth/sso', _POST)
export const PUT    = tracedRoute('PUT', '/api/auth/sso', _PUT)
