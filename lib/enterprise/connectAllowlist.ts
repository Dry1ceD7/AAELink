/**
 * D8 Connect — external partner allowlist.
 *
 * Cross-org Connect is governed: an org admin maintains the set of partner
 * domains it will federate with. The model is default-deny — a domain is an
 * approved partner only when explicitly allowed; an explicit block is recorded
 * separately for auditability but resolves the same as absent (not allowed).
 * The share-invite path consults isPartnerAllowed before sharing externally.
 */
import type { Pool } from 'pg'
import { normalizeDomain } from './domainClaiming'

export type PartnerStatus = 'allowed' | 'blocked'

export interface ConnectPartner {
  org_id: string
  partner_domain: string
  status: PartnerStatus
  added_at: number
}

export type AddPartnerResult =
  | { ok: true; domain: string; status: PartnerStatus }
  | { ok: false; code: 'invalid_domain' }

/** Add or update a partner domain entry (allowed or blocked) for an org. */
export async function setPartnerDomain(
  pool: Pool,
  orgId: string,
  rawDomain: string,
  status: PartnerStatus,
  actorId: string
): Promise<AddPartnerResult> {
  const domain = normalizeDomain(rawDomain)
  if (!domain || !domain.includes('.')) return { ok: false, code: 'invalid_domain' }

  await pool.query(
    `INSERT INTO aaelink.connect_allowlist (org_id, partner_domain, status, added_by, added_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (org_id, partner_domain) DO UPDATE SET status = $3, added_by = $4, added_at = $5`,
    [orgId, domain, status, actorId, Date.now()]
  )
  return { ok: true, domain, status }
}

/** Remove a partner domain entry. False when no such entry exists. */
export async function removePartnerDomain(pool: Pool, orgId: string, rawDomain: string): Promise<boolean> {
  const domain = normalizeDomain(rawDomain)
  const { rowCount } = await pool.query(
    `DELETE FROM aaelink.connect_allowlist WHERE org_id = $1 AND partner_domain = $2`,
    [orgId, domain]
  )
  return (rowCount ?? 0) > 0
}

/** List an org's partner entries, newest first. */
export async function listPartnerDomains(pool: Pool, orgId: string): Promise<ConnectPartner[]> {
  const { rows } = await pool.query<{ org_id: string; partner_domain: string; status: PartnerStatus; added_at: string }>(
    `SELECT org_id::text, partner_domain, status, added_at::text AS added_at
       FROM aaelink.connect_allowlist
      WHERE org_id = $1
      ORDER BY added_at DESC`,
    [orgId]
  )
  return rows.map(r => ({ ...r, added_at: Number(r.added_at) }))
}

/**
 * Whether an org may federate with a partner domain. Default-deny: true only
 * when the domain is explicitly allowed. An explicit block or no entry is false.
 */
export async function isPartnerAllowed(pool: Pool, orgId: string, rawDomain: string): Promise<boolean> {
  const domain = normalizeDomain(rawDomain)
  if (!domain) return false
  const { rows } = await pool.query<{ status: PartnerStatus }>(
    `SELECT status FROM aaelink.connect_allowlist WHERE org_id = $1 AND partner_domain = $2`,
    [orgId, domain]
  )
  return rows[0]?.status === 'allowed'
}
