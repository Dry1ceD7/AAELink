/**
 * AAELink Session Security Hardener
 *
 * Provides advanced session security controls:
 *   - Concurrent session limits (max sessions per user)
 *   - Device fingerprinting for session binding
 *   - Session anomaly detection (IP change, UA change)
 *   - Idle timeout enforcement
 *   - Forced re-authentication for sensitive operations
 *
 * Integrates with the existing aaelink.sessions table.
 */

import { createHash } from 'crypto'
import type { Pool } from 'pg'

// ── Types ────────────────────────────────────────────────────────────

export interface SessionSecurityConfig {
  /** Max concurrent sessions per user (0 = unlimited) */
  maxConcurrentSessions: number
  /** Idle timeout in milliseconds (default: 30 min) */
  idleTimeoutMs: number
  /** Whether to flag sessions on IP change */
  flagIpChange: boolean
  /** Whether to flag sessions on user-agent change */
  flagUaChange: boolean
  /** Whether to invalidate old sessions when limit exceeded (true) or block new login (false) */
  evictOldest: boolean
}

export interface DeviceFingerprint {
  userAgent: string
  ipAddress: string
  acceptLanguage: string
  screenResolution?: string
  timezone?: string
  platform?: string
}

export interface SessionAnomalyReport {
  sessionId: string
  userId: string
  anomalyType: 'ip_change' | 'ua_change' | 'idle_expired' | 'concurrent_limit'
  details: string
  timestamp: number
}

// ── Defaults ─────────────────────────────────────────────────────────

export const DEFAULT_SESSION_SECURITY: SessionSecurityConfig = {
  maxConcurrentSessions: 5,
  idleTimeoutMs: 30 * 60 * 1000,  // 30 minutes
  flagIpChange: true,
  flagUaChange: true,
  evictOldest: true,
}

// ── Fingerprinting ───────────────────────────────────────────────────

/** Generate a device fingerprint hash from request metadata */
export function generateDeviceFingerprint(fp: DeviceFingerprint): string {
  const data = [
    fp.userAgent,
    fp.acceptLanguage,
    fp.screenResolution || '',
    fp.timezone || '',
    fp.platform || '',
  ].join('|')

  return createHash('sha256').update(data).digest('hex').slice(0, 32)
}

/** Extract fingerprint data from request headers */
export function extractFingerprint(headers: Headers, ip: string): DeviceFingerprint {
  return {
    userAgent: headers.get('user-agent') || 'unknown',
    ipAddress: ip,
    acceptLanguage: headers.get('accept-language') || '',
    platform: headers.get('sec-ch-ua-platform') || '',
  }
}

// ── Concurrent Session Enforcement ───────────────────────────────────

/**
 * Check and enforce concurrent session limits.
 * Returns list of evicted session IDs (if evictOldest=true)
 * or throws if new login should be blocked.
 */
export async function enforceConcurrentLimit(
  pool: Pool,
  userId: string,
  config: SessionSecurityConfig = DEFAULT_SESSION_SECURITY
): Promise<{ allowed: boolean; evicted: string[] }> {
  if (config.maxConcurrentSessions <= 0) {
    return { allowed: true, evicted: [] }
  }

  const { rows } = await pool.query<{ id: string; created_at: string }>(
    `SELECT id, created_at FROM aaelink.sessions
     WHERE user_id = $1 AND is_active = true
     ORDER BY created_at ASC`,
    [userId]
  )

  const activeSessions = rows.length

  if (activeSessions < config.maxConcurrentSessions) {
    return { allowed: true, evicted: [] }
  }

  if (!config.evictOldest) {
    return { allowed: false, evicted: [] }
  }

  // Evict oldest sessions to make room
  const toEvict = activeSessions - config.maxConcurrentSessions + 1
  const evictIds = rows.slice(0, toEvict).map(r => r.id)

  if (evictIds.length > 0) {
    await pool.query(
      `UPDATE aaelink.sessions SET is_active = false WHERE id = ANY($1)`,
      [evictIds]
    )
  }

  return { allowed: true, evicted: evictIds }
}

// ── Idle Timeout Check ───────────────────────────────────────────────

/** Check if a session has exceeded the idle timeout */
export function isSessionIdle(
  lastActivityAt: number,
  config: SessionSecurityConfig = DEFAULT_SESSION_SECURITY
): boolean {
  return (Date.now() - lastActivityAt) > config.idleTimeoutMs
}

// ── Anomaly Detection ────────────────────────────────────────────────

/** Detect session anomalies based on request metadata changes */
export function detectAnomalies(
  sessionMeta: { ip_address?: string; user_agent?: string; last_activity_at?: number },
  currentIp: string,
  currentUa: string,
  config: SessionSecurityConfig = DEFAULT_SESSION_SECURITY
): SessionAnomalyReport[] {
  const anomalies: SessionAnomalyReport[] = []
  const now = Date.now()

  if (config.flagIpChange && sessionMeta.ip_address && sessionMeta.ip_address !== currentIp) {
    anomalies.push({
      sessionId: '',
      userId: '',
      anomalyType: 'ip_change',
      details: `IP changed from ${sessionMeta.ip_address} to ${currentIp}`,
      timestamp: now,
    })
  }

  if (config.flagUaChange && sessionMeta.user_agent && sessionMeta.user_agent !== currentUa) {
    anomalies.push({
      sessionId: '',
      userId: '',
      anomalyType: 'ua_change',
      details: `User-Agent changed`,
      timestamp: now,
    })
  }

  if (sessionMeta.last_activity_at && isSessionIdle(sessionMeta.last_activity_at, config)) {
    anomalies.push({
      sessionId: '',
      userId: '',
      anomalyType: 'idle_expired',
      details: `Session idle for ${Math.round((now - sessionMeta.last_activity_at) / 60000)} minutes`,
      timestamp: now,
    })
  }

  return anomalies
}

// ── Password Re-authentication ───────────────────────────────────────

/** List of operations requiring re-authentication */
export const SENSITIVE_OPERATIONS = [
  'user.password_change',
  'user.email_change',
  'user.mfa_enable',
  'user.mfa_disable',
  'user.api_key_create',
  'admin.user_delete',
  'admin.org_settings',
  'admin.sso_config',
  'admin.data_export',
] as const

export type SensitiveOperation = typeof SENSITIVE_OPERATIONS[number]

/** Check if an operation requires re-authentication */
export function requiresReauth(operation: string): boolean {
  return SENSITIVE_OPERATIONS.includes(operation as SensitiveOperation)
}

/** Validate recent authentication for sensitive operations */
export function isRecentlyAuthenticated(
  lastAuthAt: number,
  maxAgeMs: number = 5 * 60 * 1000  // 5 minutes
): boolean {
  return (Date.now() - lastAuthAt) < maxAgeMs
}
