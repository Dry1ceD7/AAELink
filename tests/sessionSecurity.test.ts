/**
 * AAELink — Session Security Tests
 */
import { describe, it, expect } from 'vitest'
import {
  generateDeviceFingerprint,
  extractFingerprint,
  isSessionIdle,
  detectAnomalies,
  requiresReauth,
  isRecentlyAuthenticated,
  SENSITIVE_OPERATIONS,
  DEFAULT_SESSION_SECURITY,
  type DeviceFingerprint,
} from '@/lib/auth/sessionSecurity'

// ── Fingerprinting ──────────────────────────────────────────────────

describe('SessionSecurity — Fingerprinting', () => {
  it('generates a 32-char hex fingerprint', () => {
    const fp: DeviceFingerprint = {
      userAgent: 'Mozilla/5.0',
      ipAddress: '192.168.1.1',
      acceptLanguage: 'en-US',
    }
    const hash = generateDeviceFingerprint(fp)
    expect(hash.length).toBe(32)
    expect(/^[0-9a-f]{32}$/.test(hash)).toBe(true)
  })

  it('produces consistent hashes for same input', () => {
    const fp: DeviceFingerprint = {
      userAgent: 'Mozilla/5.0',
      ipAddress: '10.0.0.1',
      acceptLanguage: 'en-US',
      platform: 'macOS',
    }
    expect(generateDeviceFingerprint(fp)).toBe(generateDeviceFingerprint(fp))
  })

  it('produces different hashes for different user agents', () => {
    const base: DeviceFingerprint = {
      userAgent: 'UA-A',
      ipAddress: '10.0.0.1',
      acceptLanguage: 'en-US',
    }
    const changed: DeviceFingerprint = { ...base, userAgent: 'UA-B' }
    expect(generateDeviceFingerprint(base)).not.toBe(generateDeviceFingerprint(changed))
  })

  it('extractFingerprint reads from Headers', () => {
    const headers = new Headers({
      'user-agent': 'TestUA',
      'accept-language': 'th-TH',
      'sec-ch-ua-platform': 'Windows',
    })
    const fp = extractFingerprint(headers, '1.2.3.4')
    expect(fp.userAgent).toBe('TestUA')
    expect(fp.ipAddress).toBe('1.2.3.4')
    expect(fp.acceptLanguage).toBe('th-TH')
    expect(fp.platform).toBe('Windows')
  })

  it('extractFingerprint defaults for missing headers', () => {
    const headers = new Headers()
    const fp = extractFingerprint(headers, '127.0.0.1')
    expect(fp.userAgent).toBe('unknown')
    expect(fp.acceptLanguage).toBe('')
  })
})

// ── Idle Timeout ────────────────────────────────────────────────────

describe('SessionSecurity — Idle Timeout', () => {
  it('active session is not idle', () => {
    const recentActivity = Date.now() - 5000 // 5 seconds ago
    expect(isSessionIdle(recentActivity)).toBe(false)
  })

  it('stale session is idle', () => {
    const oldActivity = Date.now() - (31 * 60 * 1000) // 31 minutes ago
    expect(isSessionIdle(oldActivity)).toBe(true)
  })

  it('respects custom timeout config', () => {
    const activity = Date.now() - 10_000 // 10 seconds ago
    const config = { ...DEFAULT_SESSION_SECURITY, idleTimeoutMs: 5_000 }
    expect(isSessionIdle(activity, config)).toBe(true)
  })

  it('exact boundary is not idle', () => {
    const activity = Date.now() - DEFAULT_SESSION_SECURITY.idleTimeoutMs
    // At exactly the threshold, diff === timeout, which is NOT > timeout
    expect(isSessionIdle(activity)).toBe(false)
  })
})

// ── Anomaly Detection ───────────────────────────────────────────────

describe('SessionSecurity — Anomaly Detection', () => {
  it('detects IP change', () => {
    const anomalies = detectAnomalies(
      { ip_address: '10.0.0.1', user_agent: 'UA', last_activity_at: Date.now() },
      '10.0.0.2',
      'UA',
    )
    expect(anomalies.length).toBe(1)
    expect(anomalies[0].anomalyType).toBe('ip_change')
  })

  it('detects UA change', () => {
    const anomalies = detectAnomalies(
      { ip_address: '10.0.0.1', user_agent: 'Old-UA', last_activity_at: Date.now() },
      '10.0.0.1',
      'New-UA',
    )
    expect(anomalies.length).toBe(1)
    expect(anomalies[0].anomalyType).toBe('ua_change')
  })

  it('detects idle expiration', () => {
    const oldTime = Date.now() - 2 * 60 * 60 * 1000 // 2 hours ago
    const anomalies = detectAnomalies(
      { ip_address: '10.0.0.1', user_agent: 'UA', last_activity_at: oldTime },
      '10.0.0.1',
      'UA',
    )
    expect(anomalies.some(a => a.anomalyType === 'idle_expired')).toBe(true)
  })

  it('returns empty for normal session', () => {
    const anomalies = detectAnomalies(
      { ip_address: '10.0.0.1', user_agent: 'UA', last_activity_at: Date.now() },
      '10.0.0.1',
      'UA',
    )
    expect(anomalies.length).toBe(0)
  })

  it('skips IP check when disabled', () => {
    const config = { ...DEFAULT_SESSION_SECURITY, flagIpChange: false }
    const anomalies = detectAnomalies(
      { ip_address: '10.0.0.1', user_agent: 'UA', last_activity_at: Date.now() },
      '10.0.0.2',
      'UA',
      config,
    )
    expect(anomalies.filter(a => a.anomalyType === 'ip_change').length).toBe(0)
  })
})

// ── Re-authentication ───────────────────────────────────────────────

describe('SessionSecurity — Re-authentication', () => {
  it('flags sensitive operations', () => {
    expect(requiresReauth('user.password_change')).toBe(true)
    expect(requiresReauth('user.mfa_enable')).toBe(true)
    expect(requiresReauth('admin.user_delete')).toBe(true)
    expect(requiresReauth('admin.sso_config')).toBe(true)
  })

  it('does not flag normal operations', () => {
    expect(requiresReauth('message.send')).toBe(false)
    expect(requiresReauth('channel.create')).toBe(false)
  })

  it('SENSITIVE_OPERATIONS list is complete', () => {
    expect(SENSITIVE_OPERATIONS.length).toBeGreaterThanOrEqual(8)
  })

  it('isRecentlyAuthenticated within window', () => {
    expect(isRecentlyAuthenticated(Date.now() - 1000)).toBe(true)
  })

  it('isRecentlyAuthenticated expired', () => {
    expect(isRecentlyAuthenticated(Date.now() - 10 * 60 * 1000)).toBe(false)
  })

  it('isRecentlyAuthenticated custom window', () => {
    const twoMinAgo = Date.now() - 2 * 60 * 1000
    expect(isRecentlyAuthenticated(twoMinAgo, 60_000)).toBe(false) // 1 min window
    expect(isRecentlyAuthenticated(twoMinAgo, 3 * 60_000)).toBe(true) // 3 min window
  })
})
