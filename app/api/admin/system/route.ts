// keep: enterprise admin surface kept for parity (intentional, not yet wired into UI)
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Admin System Console API — aggregate health dashboard.
 *
 * GET /api/admin/system — unified overview for the admin system console UI
 *
 * Returns a single JSON response aggregating:
 *   - Platform health (users, channels, messages, files)
 *   - Identity status (SSO providers, SCIM connections, LDAP connections, MFA enrollment)
 *   - Compliance status (DLP rules, legal holds, barriers, retention policies)
 *   - Infrastructure status (jobs, cluster nodes, encryption keys, backups)
 *   - Notification status (push tokens, email queue, SSE connections)
 *   - Call rooms status
 *
 * Designed to power a React-based admin System Console dashboard
 * that visualizes all enterprise systems in a single view.
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

  const now = Date.now()
  const day = 86400000
  const week = 7 * day

  // ── Platform Health ────────────────────────────────────────────────

  const { rows: [platformHealth] } = await pool.query<{
    total_users: string; active_users: string; guest_users: string
    total_channels: string; total_messages: string; messages_today: string
    total_files: string; total_workspaces: string
  }>(`
    SELECT
      (SELECT COUNT(*)::text FROM aaelink.users) AS total_users,
      (SELECT COUNT(*)::text FROM aaelink.users WHERE status = 'active') AS active_users,
      (SELECT COUNT(*)::text FROM aaelink.users WHERE platform_role = 'guest') AS guest_users,
      (SELECT COUNT(*)::text FROM aaelink.channels) AS total_channels,
      (SELECT COUNT(*)::text FROM aaelink.messages) AS total_messages,
      (SELECT COUNT(*)::text FROM aaelink.messages WHERE created_at > $1) AS messages_today,
      (SELECT COUNT(*)::text FROM aaelink.files) AS total_files,
      (SELECT COUNT(*)::text FROM aaelink.workspaces) AS total_workspaces
  `, [now - day])

  // ── Identity & Auth ────────────────────────────────────────────────

  const { rows: [identityStatus] } = await pool.query<{
    sso_providers: string; sso_active: string
    scim_connections: string; scim_active: string
    ldap_connections: string; ldap_active: string
    mfa_enrolled: string; mfa_totp: string
    active_sessions: string
  }>(`
    SELECT
      (SELECT COUNT(*)::text FROM aaelink.sso_providers) AS sso_providers,
      (SELECT COUNT(*)::text FROM aaelink.sso_providers WHERE is_active = true) AS sso_active,
      (SELECT COUNT(*)::text FROM aaelink.scim_connections) AS scim_connections,
      (SELECT COUNT(*)::text FROM aaelink.scim_connections WHERE is_active = true) AS scim_active,
      (SELECT COUNT(*)::text FROM aaelink.ldap_connections) AS ldap_connections,
      (SELECT COUNT(*)::text FROM aaelink.ldap_connections WHERE is_active = true) AS ldap_active,
      (SELECT COUNT(*)::text FROM aaelink.mfa_enrollments WHERE is_active = true) AS mfa_enrolled,
      (SELECT COUNT(*)::text FROM aaelink.mfa_enrollments WHERE method = 'totp' AND is_active = true) AS mfa_totp,
      (SELECT COUNT(*)::text FROM aaelink.sessions) AS active_sessions
  `)

  // ── Compliance ─────────────────────────────────────────────────────

  const { rows: [complianceStatus] } = await pool.query<{
    dlp_rules: string; dlp_active: string; dlp_violations_week: string
    legal_holds: string; legal_holds_active: string
    barriers: string; barriers_active: string
    retention_policies: string
  }>(`
    SELECT
      (SELECT COUNT(*)::text FROM aaelink.dlp_rules) AS dlp_rules,
      (SELECT COUNT(*)::text FROM aaelink.dlp_rules WHERE is_active = true) AS dlp_active,
      (SELECT COUNT(*)::text FROM aaelink.audit_log WHERE action LIKE 'dlp_%' AND created_at > $1) AS dlp_violations_week,
      (SELECT COUNT(*)::text FROM aaelink.legal_holds) AS legal_holds,
      (SELECT COUNT(*)::text FROM aaelink.legal_holds WHERE status = 'active') AS legal_holds_active,
      (SELECT COUNT(*)::text FROM aaelink.information_barriers) AS barriers,
      (SELECT COUNT(*)::text FROM aaelink.information_barriers WHERE is_active = true) AS barriers_active,
      (SELECT COUNT(*)::text FROM aaelink.retention_policies) AS retention_policies
  `, [now - week])

  // ── Infrastructure ─────────────────────────────────────────────────

  const { rows: [infraStatus] } = await pool.query<{
    jobs_pending: string; jobs_running: string; jobs_failed_today: string; jobs_completed_today: string
    cluster_nodes: string; cluster_healthy: string
    encryption_keys: string; encryption_active: string
    devices_trusted: string
  }>(`
    SELECT
      (SELECT COUNT(*)::text FROM aaelink.jobs WHERE status = 'pending') AS jobs_pending,
      (SELECT COUNT(*)::text FROM aaelink.jobs WHERE status = 'running') AS jobs_running,
      (SELECT COUNT(*)::text FROM aaelink.jobs WHERE status = 'failed' AND created_at > $1) AS jobs_failed_today,
      (SELECT COUNT(*)::text FROM aaelink.jobs WHERE status = 'completed' AND created_at > $1) AS jobs_completed_today,
      (SELECT COUNT(*)::text FROM aaelink.cluster_nodes) AS cluster_nodes,
      (SELECT COUNT(*)::text FROM aaelink.cluster_nodes WHERE last_heartbeat > $2) AS cluster_healthy,
      (SELECT COUNT(*)::text FROM aaelink.encryption_keys) AS encryption_keys,
      (SELECT COUNT(*)::text FROM aaelink.encryption_keys WHERE status = 'active') AS encryption_active,
      (SELECT COUNT(*)::text FROM aaelink.devices WHERE trust_level IN ('trusted', 'managed')) AS devices_trusted
  `, [now - day, now - 90000]) // 90s heartbeat window

  // ── Notifications ──────────────────────────────────────────────────

  const { rows: [notifStatus] } = await pool.query<{
    push_tokens: string; push_apns: string; push_fcm: string
    push_sent_today: string; push_failed_today: string
    email_queued: string
  }>(`
    SELECT
      (SELECT COUNT(*)::text FROM aaelink.push_tokens WHERE is_active = true) AS push_tokens,
      (SELECT COUNT(*)::text FROM aaelink.push_tokens WHERE provider = 'apns' AND is_active = true) AS push_apns,
      (SELECT COUNT(*)::text FROM aaelink.push_tokens WHERE provider = 'fcm' AND is_active = true) AS push_fcm,
      (SELECT COUNT(*)::text FROM aaelink.push_log WHERE created_at > $1) AS push_sent_today,
      (SELECT COUNT(*)::text FROM aaelink.push_log WHERE status = 'failed' AND created_at > $1) AS push_failed_today,
      (SELECT COUNT(*)::text FROM aaelink.jobs WHERE type = 'email_send' AND status = 'pending') AS email_queued
  `, [now - day])

  // ── Calls ──────────────────────────────────────────────────────────

  const { rows: [callsStatus] } = await pool.query<{
    active_rooms: string; total_participants: string; calls_today: string
  }>(`
    SELECT
      (SELECT COUNT(*)::text FROM aaelink.call_rooms WHERE status = 'active') AS active_rooms,
      (SELECT COUNT(*)::text FROM aaelink.call_participants WHERE left_at = 0) AS total_participants,
      (SELECT COUNT(*)::text FROM aaelink.call_rooms WHERE created_at > $1) AS calls_today
  `, [now - day])

  // ── System Config ──────────────────────────────────────────────────

  const { rows: configs } = await pool.query<{ key: string; value: string; updated_at: string }>(
    `SELECT key, value, updated_at::text FROM aaelink.system_config ORDER BY key`
  )

  const configMap: Record<string, unknown> = {}
  for (const cfg of configs) {
    try { configMap[cfg.key] = JSON.parse(cfg.value) } catch { configMap[cfg.key] = cfg.value }
  }

  // ── Response ───────────────────────────────────────────────────────

  const numify = (obj: Record<string, string>) => {
    const result: Record<string, number> = {}
    for (const [k, v] of Object.entries(obj)) result[k] = Number(v)
    return result
  }

  return NextResponse.json({
    timestamp: now,
    version: process.env.npm_package_version || '0.0.7-alpha',
    platform: numify(platformHealth),
    identity: numify(identityStatus),
    compliance: numify(complianceStatus),
    infrastructure: numify(infraStatus),
    notifications: numify(notifStatus),
    calls: numify(callsStatus),
    system_config: configMap,
    process: {
      node_version: process.version,
      uptime_seconds: Math.floor(process.uptime()),
      memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      pid: process.pid,
    },
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/system', _GET)
