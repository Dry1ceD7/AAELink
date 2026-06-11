import { randomUUID } from 'crypto'
import type { Pool } from 'pg'
import { getSessionPolicy, sessionTtlMs } from '@/lib/auth/sessionPolicy'
import { enforceSessionLimits } from '@/lib/auth/sessionEnforcement'
import type { SsoProviderConfig } from '@/lib/auth/ssoProvider'
import { resolveWorkspaceRole, type MappedIdentity } from '@/lib/auth/ssoClaims'
import { applyGroupRoleMappings } from '@/lib/auth/idpRoleMappings'
import { emitUserCreated } from '@/lib/webhooks/webhookEmitter'

/**
 * Link-or-provision an SSO identity and establish an AAELink session.
 *
 * Resolution order: (1) existing identity link by (provider, subject),
 * (2) existing user by email (account linking — same human, password account
 * adopts SSO), else (3) JIT provision a fresh user when the provider allows it.
 * New users get platform_role 'employee' (NOT admin) and are added to the
 * provider's default workspace with a clamped member/guest role. Returns a
 * sessionId + sessionMs for the route to set the cookie exactly as password
 * login does.
 */

export interface SsoLoginResult {
  userId: string
  sessionId: string
  sessionMs: number
  provisioned: boolean
  /** True when the provider enforces MFA: session is withheld until step-up. */
  mfaPending: boolean
}

async function uniqueUsername(pool: Pool, email: string): Promise<string> {
  const base = email.split('@')[0].replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 24) || 'user'
  for (let i = 0; i < 6; i++) {
    const candidate = i === 0 ? base : `${base}_${Math.floor(Math.random() * 10000)}`
    const { rows } = await pool.query<{ ok: number }>(
      `SELECT 1 AS ok FROM aaelink.users WHERE lower(username) = lower($1) LIMIT 1`,
      [candidate]
    )
    if (rows.length === 0) return candidate
  }
  return `${base}_${randomUUID().slice(0, 8)}`
}

async function findUserId(
  pool: Pool,
  cfg: SsoProviderConfig,
  identity: MappedIdentity
): Promise<{ userId: string; provisioned: boolean } | null> {
  const linked = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM aaelink.sso_identity_links WHERE provider_id = $1 AND subject = $2`,
    [cfg.id, identity.subject]
  )
  if (linked.rows[0]) return { userId: linked.rows[0].user_id, provisioned: false }

  const byEmail = await pool.query<{ id: string }>(
    `SELECT id FROM aaelink.users WHERE lower(email) = lower($1) LIMIT 1`,
    [identity.email]
  )
  if (byEmail.rows[0]) return { userId: byEmail.rows[0].id, provisioned: false }

  if (!cfg.jitProvisioning) return null

  const id = randomUUID()
  const now = Date.now()
  const username = await uniqueUsername(pool, identity.email)
  await pool.query(
    `INSERT INTO aaelink.users
       (id, username, email, password_hash, first_name, last_name, nickname,
        created_at, last_seen_at, platform_role)
     VALUES ($1,$2,$3,'sso_managed',$4,$5,$6,$7,$7,'employee')`,
    [id, username, identity.email, identity.firstName, identity.lastName, identity.displayName, now]
  )
  // Emit user.created best-effort — JIT provisioned via SSO.
  try {
    await emitUserCreated(pool, { user_id: id, email: identity.email, role: 'employee', created_by: id })
  } catch { /* best-effort */ }
  return { userId: id, provisioned: true }
}

async function ensureWorkspaceMembership(
  pool: Pool,
  cfg: SsoProviderConfig,
  userId: string,
  identity: MappedIdentity
): Promise<void> {
  if (!cfg.defaultWorkspaceId) return
  const { rows } = await pool.query<{ ok: number }>(
    `SELECT 1 AS ok FROM aaelink.workspaces WHERE id = $1`,
    [cfg.defaultWorkspaceId]
  )
  if (rows.length === 0) return
  const role = resolveWorkspaceRole(identity, cfg)
  await pool.query(
    `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id, user_id) DO NOTHING`,
    [cfg.defaultWorkspaceId, userId, role]
  )
}

export async function loginViaSso(
  pool: Pool,
  cfg: SsoProviderConfig,
  identity: MappedIdentity,
  meta: { ip: string; userAgent: string }
): Promise<SsoLoginResult | null> {
  const resolved = await findUserId(pool, cfg, identity)
  if (!resolved) return null
  const { userId, provisioned } = resolved
  const now = Date.now()

  await pool.query(
    `INSERT INTO aaelink.sso_identity_links (provider_id, subject, user_id, created_at, last_login_at)
     VALUES ($1,$2,$3,$4,$4)
     ON CONFLICT (provider_id, subject)
       DO UPDATE SET last_login_at = $4`,
    [cfg.id, identity.subject, userId, now]
  )

  await ensureWorkspaceMembership(pool, cfg, userId, identity)

  // Grant any IdP group → role mappings (Admin 35 / Identity 13). Grant-only:
  // super_admin is clamped out, and removal from a group never auto-demotes.
  // sso_providers is not org-scoped, so only global (org_id NULL) mappings apply.
  await applyGroupRoleMappings(pool, userId, identity.groups, {
    orgId: null,
    defaultWorkspaceId: cfg.defaultWorkspaceId,
  }).catch(() => { /* non-critical: role grant must not block login */ })

  const sessionId = randomUUID()
  const sessionPolicy = await getSessionPolicy(pool, now)
  const sessionMs = sessionTtlMs(sessionPolicy, 'web')
  // Providers with enforce_mfa create a session that readSessionUserId withholds
  // until the user clears MFA step-up (POST /api/auth/mfa/stepup).
  const mfaPending = cfg.enforceMfa === true
  await pool.query(
    `INSERT INTO aaelink.sessions (id, user_id, expires_at, user_agent, ip_address, created_at, last_active_at, mfa_pending)
     VALUES ($1,$2,$3,$4,$5,$6,$6,$7)`,
    [sessionId, userId, now + sessionMs, meta.userAgent, meta.ip, now, mfaPending]
  )
  // Enforce max_sessions_per_user / single_session_mode (D2). Best-effort.
  await enforceSessionLimits(pool, userId, sessionPolicy, sessionId, now).catch(() => { /* non-critical */ })
  await pool.query(
    `UPDATE aaelink.users SET last_seen_at = $1, last_login_at = $1,
            login_count = COALESCE(login_count, 0) + 1 WHERE id = $2`,
    [now, userId]
  )
  await pool
    .query(
      `UPDATE aaelink.sso_providers
          SET login_count = login_count + 1, last_login_at = $1
        WHERE id = $2`,
      [now, cfg.id]
    )
    .catch(() => { /* non-critical */ })

  return { userId, sessionId, sessionMs, provisioned, mfaPending }
}
