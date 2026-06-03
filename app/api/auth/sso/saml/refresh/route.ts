import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { fetchSamlIdpMetadata } from '@/lib/auth/samlMetadata'

/**
 * POST /api/auth/sso/saml/refresh { provider_id }
 *
 * Re-fetch a SAML provider's IdP metadata_url and update its entry point +
 * signing-cert set. This is the cert-rotation path (ADR 0015): when an IdP
 * rolls signing keys it advertises old+new certs in metadata; refreshing picks
 * them all up so logins keep validating. super_admin only.
 */
async function _POST(req: Request) {
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

  const body = (await req.json().catch(() => ({}))) as { provider_id?: string }
  const provId = String(body.provider_id || '').trim()
  if (!provId) return NextResponse.json({ error: 'provider_id_required' }, { status: 400 })

  const { rows } = await pool.query<{ type: string; metadata_url: string }>(
    `SELECT type, metadata_url FROM aaelink.sso_providers WHERE id = $1`, [provId]
  )
  const prov = rows[0]
  if (!prov) return NextResponse.json({ error: 'provider_not_found' }, { status: 404 })
  if (prov.type !== 'saml') return NextResponse.json({ error: 'not_a_saml_provider' }, { status: 400 })
  if (!prov.metadata_url) return NextResponse.json({ error: 'metadata_url_unset' }, { status: 400 })

  let md
  try {
    md = await fetchSamlIdpMetadata(prov.metadata_url)
  } catch {
    return NextResponse.json({ error: 'saml_metadata_fetch_failed' }, { status: 400 })
  }

  const now = Date.now()
  await pool.query(
    `UPDATE aaelink.sso_providers
        SET saml_entry_point = $1, saml_idp_cert = $2, saml_idp_certs = $3,
            issuer = COALESCE(NULLIF(issuer, ''), $4), updated_at = $5
      WHERE id = $6`,
    [md.entryPoint, md.certs[0] || '', JSON.stringify(md.certs), md.entityId, now, provId]
  )

  await pool.query(
    `INSERT INTO aaelink.audit_log (id, actor_id, action, resource_kind, resource_id, metadata, created_at)
     VALUES ($1, $2, 'sso_saml_metadata_refreshed', 'sso', $3, $4, $5)`,
    [randomUUID(), uid, provId, JSON.stringify({ cert_count: md.certs.length, entry_point: md.entryPoint }), now]
  )

  return NextResponse.json({ ok: true, provider_id: provId, cert_count: md.certs.length, entry_point: md.entryPoint })
}

export const POST = tracedRoute('POST', '/api/auth/sso/saml/refresh', _POST)
