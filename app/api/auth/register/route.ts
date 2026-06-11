import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { hashPassword } from '@/lib/auth/password'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { findCapturingOrg } from '@/lib/enterprise/domainClaiming'
import { getPasswordPolicy, validatePassword } from '@/lib/auth/passwordPolicy'
import { emitUserCreated } from '@/lib/webhooks/webhookEmitter'

/** Self-service sign-up is only on when explicitly set to `1` (internal deployments usually leave it off). */
function openRegistration(): boolean {
  return process.env.AAELINK_OPEN_REGISTRATION === '1'
}

/**
 * Strict-enough email format: a single '@' with no whitespace or control chars on
 * either side and a dotted domain. Mirrors lib/enterprise/bulkProvision's EMAIL_RE
 * so every ingress that persists aaelink.users.email rejects the CRLF that would
 * otherwise become an SMTP header-injection payload downstream.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email)
}

async function _POST(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  if (!openRegistration()) {
    const { rows } = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM aaelink.users`)
    if (Number(rows[0]?.n || 0) > 0) {
      return NextResponse.json({ error: 'registration_closed' }, { status: 403 })
    }
  }
  try {
    const body = (await req.json()) as {
      username?: string
      email?: string
      password?: string
      first_name?: string
      last_name?: string
    }
    const username = String(body.username || '').trim()
    const email = String(body.email || '').trim()
    const password = String(body.password || '')
    // Strict email format: no whitespace/control chars on either side of a single
    // '@'. A bare .includes('@') let an interior CRLF survive .trim() and persist
    // (email has no DB format CHECK), which becomes an SMTP header-injection vector
    // at digest time (To:/RCPT TO built from this value). Reject it at ingress.
    if (username.length < 2 || !isValidEmail(email)) {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
    }
    // Enforce the admin-configured password policy (default: 8-char min, rest off).
    const policy = await getPasswordPolicy(pool)
    const detail = validatePassword(policy, password, { username, email })
    if (detail.length > 0) {
      return NextResponse.json({ error: 'password_policy_violation', detail }, { status: 400 })
    }
    const id = randomUUID()
    const now = Date.now()
    const password_hash = hashPassword(password)
    const first_name = String(body.first_name || '').trim()
    const last_name = String(body.last_name || '').trim()
    await pool.query(
      `INSERT INTO aaelink.users (id, username, email, password_hash, first_name, last_name, nickname, created_at, last_seen_at, platform_role, password_changed_at)
       VALUES ($1, $2, $3, $4, $5, $6, '', $7, 0, 'employee', $7)`,
      [id, username, email, password_hash, first_name, last_name, now]
    )
    // Emit user.created best-effort — must not block or fail the registration.
    try {
      await emitUserCreated(pool, { user_id: id, email, role: 'employee', created_by: id })
    } catch { /* best-effort */ }
    // D2 domain-based account capture: if the email's domain is verified by an
    // org, enroll the new user as an org member (lib/enterprise/domainClaiming).
    const capturedOrgId = await findCapturingOrg(pool, email)
    if (capturedOrgId) {
      await pool.query(
        `INSERT INTO aaelink.org_members (org_id, user_id, role)
         VALUES ($1, $2, 'member') ON CONFLICT (org_id, user_id) DO NOTHING`,
        [capturedOrgId, id]
      )
    }
    const { rows } = await pool.query(
      `SELECT id, username, email, first_name, last_name, nickname, platform_role, avatar_url, job_title, phone, timezone, status_text, status_emoji FROM aaelink.users WHERE id = $1`,
      [id]
    )
    return NextResponse.json({ user: rows[0], captured_org_id: capturedOrgId ?? null })
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code
    if (code === '23505') {
      return NextResponse.json({ error: 'username_or_email_taken' }, { status: 409 })
    }
    return NextResponse.json({ error: 'register_failed' }, { status: 400 })
  }
}

// ── Traced export ───────────────────────────────────────────────────
export const POST = tracedRoute('POST', '/api/auth/register', _POST)
