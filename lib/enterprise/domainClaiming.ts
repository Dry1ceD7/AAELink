/**
 * D2 Identity — domain claiming + domain-based account capture.
 *
 * An org claims a DNS domain, proves ownership by publishing a TXT record
 * carrying a per-claim token, and thereafter captures accounts whose email is
 * under that domain (Slack domain claiming). A domain may be VERIFIED by at most
 * one org (enforced by a partial unique index), but several orgs may hold
 * competing pending claims until one verifies.
 *
 * DNS resolution is injected (TxtResolver) so the verification logic is pure and
 * testable; the route supplies a real resolver backed by node:dns/promises.
 */
import type { Pool } from 'pg'
import { randomUUID } from 'crypto'

/** Resolves the TXT records for a hostname (one string per record). */
export type TxtResolver = (hostname: string) => Promise<string[]>

/** TXT record value an org must publish at the domain root to verify a claim. */
export function verificationRecord(token: string): string {
  return `aaelink-verify=${token}`
}

/** Normalize a domain: trim, lowercase, strip a leading "@" or scheme/path. */
export function normalizeDomain(input: string): string {
  let d = String(input || '').trim().toLowerCase()
  d = d.replace(/^https?:\/\//, '').replace(/^@/, '')
  d = d.split('/')[0].split(':')[0]
  return d
}

/** Extract the lowercased domain part of an email, or '' when malformed. */
export function emailDomain(email: string): string {
  const at = String(email || '').trim().toLowerCase().lastIndexOf('@')
  return at >= 0 ? email.trim().toLowerCase().slice(at + 1) : ''
}

export interface OrgDomain {
  org_id: string
  domain: string
  verification_token: string
  verified: boolean
  verified_at: number
  created_at: number
}

export type ClaimDomainResult =
  | { ok: true; domain: string; token: string; record: string }
  | { ok: false; code: 'invalid_domain' | 'claimed_by_other_org' | 'already_claimed' }

/**
 * Register a pending domain claim for an org and return the TXT token the org
 * must publish. Rejects a domain already verified by another org. Re-claiming a
 * domain the org already holds returns already_claimed (idempotency guard).
 */
export async function claimDomain(
  pool: Pool,
  orgId: string,
  rawDomain: string,
  actorId: string
): Promise<ClaimDomainResult> {
  const domain = normalizeDomain(rawDomain)
  if (!domain || !domain.includes('.')) return { ok: false, code: 'invalid_domain' }

  const { rows: verifiedRows } = await pool.query<{ org_id: string }>(
    `SELECT org_id::text FROM aaelink.org_domains WHERE domain = $1 AND verified = true`,
    [domain]
  )
  if (verifiedRows[0] && verifiedRows[0].org_id !== orgId) {
    return { ok: false, code: 'claimed_by_other_org' }
  }

  const { rows: mine } = await pool.query(
    `SELECT 1 FROM aaelink.org_domains WHERE org_id = $1 AND domain = $2`,
    [orgId, domain]
  )
  if (mine.length > 0) return { ok: false, code: 'already_claimed' }

  const token = randomUUID().replace(/-/g, '')
  await pool.query(
    `INSERT INTO aaelink.org_domains (org_id, domain, verification_token, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [orgId, domain, token, actorId, Date.now()]
  )
  return { ok: true, domain, token, record: verificationRecord(token) }
}

export type VerifyDomainResult =
  | { ok: true; domain: string }
  | { ok: false; code: 'not_found' | 'already_verified' | 'claimed_by_other_org' | 'txt_not_found' }

/**
 * Verify a pending claim by resolving the domain's TXT records and matching the
 * stored token. On success the claim flips to verified; the partial unique index
 * guarantees no other org already holds it. The resolver is injected so this is
 * deterministic under test.
 */
export async function verifyDomain(
  pool: Pool,
  orgId: string,
  rawDomain: string,
  resolveTxt: TxtResolver
): Promise<VerifyDomainResult> {
  const domain = normalizeDomain(rawDomain)
  const { rows } = await pool.query<{ verification_token: string; verified: boolean }>(
    `SELECT verification_token, verified FROM aaelink.org_domains WHERE org_id = $1 AND domain = $2`,
    [orgId, domain]
  )
  const claim = rows[0]
  if (!claim) return { ok: false, code: 'not_found' }
  if (claim.verified) return { ok: false, code: 'already_verified' }

  const { rows: otherVerified } = await pool.query(
    `SELECT 1 FROM aaelink.org_domains WHERE domain = $1 AND verified = true AND org_id <> $2`,
    [domain, orgId]
  )
  if (otherVerified.length > 0) return { ok: false, code: 'claimed_by_other_org' }

  const want = verificationRecord(claim.verification_token)
  let records: string[] = []
  try {
    records = await resolveTxt(domain)
  } catch {
    records = []
  }
  if (!records.map(r => r.trim()).includes(want)) return { ok: false, code: 'txt_not_found' }

  await pool.query(
    `UPDATE aaelink.org_domains SET verified = true, verified_at = $3 WHERE org_id = $1 AND domain = $2`,
    [orgId, domain, Date.now()]
  )
  return { ok: true, domain }
}

/** List an org's domain claims (verified and pending), newest first. */
export async function listOrgDomains(pool: Pool, orgId: string): Promise<OrgDomain[]> {
  const { rows } = await pool.query<{
    org_id: string
    domain: string
    verification_token: string
    verified: boolean
    verified_at: string
    created_at: string
  }>(
    `SELECT org_id::text, domain, verification_token, verified,
            verified_at::text AS verified_at, created_at::text AS created_at
       FROM aaelink.org_domains
      WHERE org_id = $1
      ORDER BY created_at DESC`,
    [orgId]
  )
  return rows.map(r => ({ ...r, verified_at: Number(r.verified_at), created_at: Number(r.created_at) }))
}

/** Remove a domain claim from an org. Returns false when no such claim exists. */
export async function removeOrgDomain(pool: Pool, orgId: string, rawDomain: string): Promise<boolean> {
  const domain = normalizeDomain(rawDomain)
  const { rowCount } = await pool.query(
    `DELETE FROM aaelink.org_domains WHERE org_id = $1 AND domain = $2`,
    [orgId, domain]
  )
  return (rowCount ?? 0) > 0
}

/**
 * Domain-based account capture: resolve the org that has VERIFIED the domain of
 * an email address, or null when the domain is unclaimed. Used at registration
 * to auto-assign a new account to its org.
 */
export async function findCapturingOrg(pool: Pool, email: string): Promise<string | null> {
  const domain = emailDomain(email)
  if (!domain) return null
  const { rows } = await pool.query<{ org_id: string }>(
    `SELECT org_id::text FROM aaelink.org_domains WHERE domain = $1 AND verified = true LIMIT 1`,
    [domain]
  )
  return rows[0]?.org_id ?? null
}
