/**
 * AAELink — CSP & Session Security Tests
 *
 * Validates CSP policy generation, nonce handling, security headers,
 * device fingerprinting, anomaly detection, and session limits.
 */
import { describe, it, expect } from 'vitest'
import { generateNonce, buildCspPolicy, parseCspReport } from '@/lib/auth/csp'
import {
  generateDeviceFingerprint,
  detectAnomalies,
  isSessionIdle,
  requiresReauth,
  isRecentlyAuthenticated,
  DEFAULT_SESSION_SECURITY,
} from '@/lib/auth/sessionSecurity'

// ── CSP: Nonce ───────────────────────────────────────────────────────

describe('CSP — Nonce Generation', () => {
  it('generates a base64 nonce', () => {
    const nonce = generateNonce()
    expect(nonce).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(nonce.length).toBeGreaterThanOrEqual(20)
  })

  it('generates unique nonces', () => {
    const n1 = generateNonce()
    const n2 = generateNonce()
    expect(n1).not.toBe(n2)
  })
})

// ── CSP: Policy Builder ──────────────────────────────────────────────

describe('CSP — Policy Builder', () => {
  it('includes nonce in script-src and style-src', () => {
    const nonce = 'test-nonce-123'
    const policy = buildCspPolicy(nonce)
    expect(policy).toContain(`'nonce-${nonce}'`)
    expect(policy).toContain("script-src")
    expect(policy).toContain("style-src")
  })

  it('includes strict-dynamic in script-src', () => {
    const policy = buildCspPolicy('n')
    expect(policy).toContain("'strict-dynamic'")
  })

  it('blocks object-src by default', () => {
    const policy = buildCspPolicy('n')
    expect(policy).toContain("object-src 'none'")
  })

  it('includes frame-ancestors self by default', () => {
    const policy = buildCspPolicy('n')
    expect(policy).toContain("frame-ancestors 'self'")
  })

  it('includes upgrade-insecure-requests', () => {
    const policy = buildCspPolicy('n')
    expect(policy).toContain('upgrade-insecure-requests')
  })

  it('allows unsafe-eval when configured', () => {
    const policy = buildCspPolicy('n', { allowUnsafeEval: true })
    expect(policy).toContain("'unsafe-eval'")
  })

  it('does not include unsafe-eval by default', () => {
    const policy = buildCspPolicy('n')
    expect(policy).not.toContain("'unsafe-eval'")
  })

  it('includes trusted sources when configured', () => {
    const policy = buildCspPolicy('n', {
      trustedScriptSrcs: ['https://cdn.example.com'],
    })
    expect(policy).toContain('https://cdn.example.com')
  })

  it('includes report-uri when configured', () => {
    const policy = buildCspPolicy('n', { reportUri: '/csp-violations' })
    expect(policy).toContain('report-uri /csp-violations')
  })
})

// ── CSP: Report Parsing ──────────────────────────────────────────────

describe('CSP — Report Parsing', () => {
  it('parses a standard violation report', () => {
    const result = parseCspReport({
      'csp-report': {
        'document-uri': 'https://app.example.com/',
        'violated-directive': 'script-src',
        'effective-directive': 'script-src',
        'blocked-uri': 'https://evil.com/script.js',
        'source-file': 'https://app.example.com/page.html',
        'line-number': 42,
      },
    })
    expect(result).not.toBeNull()
    expect(result!.directive).toBe('script-src')
    expect(result!.blockedUri).toBe('https://evil.com/script.js')
    expect(result!.lineNumber).toBe(42)
  })

  it('returns null for invalid report', () => {
    expect(parseCspReport({})).toBeNull()
  })
})

// ── Session Security: Fingerprinting ─────────────────────────────────

describe('Session Security — Fingerprinting', () => {
  it('generates consistent fingerprints for same data', () => {
    const fp1 = generateDeviceFingerprint({
      userAgent: 'Mozilla/5.0', ipAddress: '10.0.0.1',
      acceptLanguage: 'en-US', platform: 'macOS',
    })
    const fp2 = generateDeviceFingerprint({
      userAgent: 'Mozilla/5.0', ipAddress: '10.0.0.1',
      acceptLanguage: 'en-US', platform: 'macOS',
    })
    expect(fp1).toBe(fp2)
  })

  it('generates different fingerprints for different data', () => {
    const fp1 = generateDeviceFingerprint({
      userAgent: 'Chrome', ipAddress: '10.0.0.1', acceptLanguage: 'en',
    })
    const fp2 = generateDeviceFingerprint({
      userAgent: 'Firefox', ipAddress: '10.0.0.1', acceptLanguage: 'en',
    })
    expect(fp1).not.toBe(fp2)
  })

  it('returns a 32-char hex string', () => {
    const fp = generateDeviceFingerprint({
      userAgent: 'test', ipAddress: '1.2.3.4', acceptLanguage: 'en',
    })
    expect(fp).toMatch(/^[a-f0-9]{32}$/)
  })
})

// ── Session Security: Anomaly Detection ──────────────────────────────

describe('Session Security — Anomaly Detection', () => {
  it('detects IP change', () => {
    const anomalies = detectAnomalies(
      { ip_address: '10.0.0.1', user_agent: 'Chrome' },
      '192.168.1.1', 'Chrome',
    )
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0].anomalyType).toBe('ip_change')
  })

  it('detects UA change', () => {
    const anomalies = detectAnomalies(
      { ip_address: '10.0.0.1', user_agent: 'Chrome' },
      '10.0.0.1', 'Firefox',
    )
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0].anomalyType).toBe('ua_change')
  })

  it('detects idle expiration', () => {
    const oldTime = Date.now() - 60 * 60 * 1000 // 1 hour ago
    const anomalies = detectAnomalies(
      { last_activity_at: oldTime },
      '10.0.0.1', 'Chrome',
    )
    const idle = anomalies.find(a => a.anomalyType === 'idle_expired')
    expect(idle).toBeDefined()
  })

  it('returns empty for matching metadata', () => {
    const anomalies = detectAnomalies(
      { ip_address: '10.0.0.1', user_agent: 'Chrome', last_activity_at: Date.now() },
      '10.0.0.1', 'Chrome',
    )
    expect(anomalies).toHaveLength(0)
  })
})

// ── Session Security: Idle Timeout ───────────────────────────────────

describe('Session Security — Idle Timeout', () => {
  it('returns false for recent activity', () => {
    expect(isSessionIdle(Date.now())).toBe(false)
  })

  it('returns true for old activity', () => {
    const old = Date.now() - 60 * 60 * 1000 // 1 hour ago
    expect(isSessionIdle(old)).toBe(true)
  })
})

// ── Session Security: Re-authentication ──────────────────────────────

describe('Session Security — Re-authentication', () => {
  it('identifies sensitive operations', () => {
    expect(requiresReauth('user.password_change')).toBe(true)
    expect(requiresReauth('admin.data_export')).toBe(true)
    expect(requiresReauth('message.send')).toBe(false)
  })

  it('validates recent authentication', () => {
    expect(isRecentlyAuthenticated(Date.now())).toBe(true)
    expect(isRecentlyAuthenticated(Date.now() - 10 * 60 * 1000)).toBe(false) // 10 min ago
  })
})
