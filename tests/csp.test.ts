/**
 * AAELink — CSP Policy Builder Tests
 */
import { describe, it, expect } from 'vitest'
import { generateNonce, buildCspPolicy, parseCspReport, type CspViolationReport } from '@/lib/csp'

describe('CSP — generateNonce', () => {
  it('returns a base64 string', () => {
    const nonce = generateNonce()
    expect(typeof nonce).toBe('string')
    expect(nonce.length).toBeGreaterThan(0)
  })

  it('generates unique nonces', () => {
    const n1 = generateNonce()
    const n2 = generateNonce()
    expect(n1).not.toBe(n2)
  })
})

describe('CSP — buildCspPolicy', () => {
  const nonce = 'test-nonce-abc123'

  it('includes nonce in script-src', () => {
    const policy = buildCspPolicy(nonce)
    expect(policy).toContain(`'nonce-${nonce}'`)
  })

  it('includes strict-dynamic in script-src', () => {
    const policy = buildCspPolicy(nonce)
    expect(policy).toContain("'strict-dynamic'")
  })

  it('includes default-src self', () => {
    const policy = buildCspPolicy(nonce)
    expect(policy).toContain("default-src 'self'")
  })

  it('blocks object-src', () => {
    const policy = buildCspPolicy(nonce)
    expect(policy).toContain("object-src 'none'")
  })

  it('includes upgrade-insecure-requests', () => {
    const policy = buildCspPolicy(nonce)
    expect(policy).toContain('upgrade-insecure-requests')
  })

  it('includes Google Fonts in style-src by default', () => {
    const policy = buildCspPolicy(nonce)
    expect(policy).toContain('https://fonts.googleapis.com')
  })

  it('includes Google Fonts in font-src by default', () => {
    const policy = buildCspPolicy(nonce)
    expect(policy).toContain('https://fonts.gstatic.com')
  })

  it('includes report-uri by default', () => {
    const policy = buildCspPolicy(nonce)
    expect(policy).toContain('report-uri /api/csp-report')
  })

  it('allows unsafe-eval when configured', () => {
    const policy = buildCspPolicy(nonce, { allowUnsafeEval: true })
    expect(policy).toContain("'unsafe-eval'")
  })

  it('excludes unsafe-eval by default', () => {
    const policy = buildCspPolicy(nonce)
    expect(policy).not.toContain("'unsafe-eval'")
  })

  it('allows unsafe-inline styles when configured', () => {
    const policy = buildCspPolicy(nonce, { allowUnsafeInlineStyles: true })
    expect(policy).toContain("'unsafe-inline'")
  })

  it('includes trusted script sources', () => {
    const policy = buildCspPolicy(nonce, { trustedScriptSrcs: ['https://cdn.example.com'] })
    expect(policy).toContain('https://cdn.example.com')
  })

  it('includes wss: in connect-src for WebSocket', () => {
    const policy = buildCspPolicy(nonce)
    expect(policy).toContain('wss:')
  })

  it('includes data: and blob: in img-src', () => {
    const policy = buildCspPolicy(nonce)
    expect(policy).toContain('data:')
    expect(policy).toContain('blob:')
  })

  it('includes frame-ancestors self by default', () => {
    const policy = buildCspPolicy(nonce)
    expect(policy).toContain("frame-ancestors 'self'")
  })

  it('includes form-action self', () => {
    const policy = buildCspPolicy(nonce)
    expect(policy).toContain("form-action 'self'")
  })

  it('includes base-uri self', () => {
    const policy = buildCspPolicy(nonce)
    expect(policy).toContain("base-uri 'self'")
  })
})

describe('CSP — parseCspReport', () => {
  it('returns null for empty body', () => {
    expect(parseCspReport({} as CspViolationReport)).toBeNull()
  })

  it('parses a valid violation report', () => {
    const report: CspViolationReport = {
      'csp-report': {
        'document-uri': 'https://app.aaelink.com/',
        'violated-directive': 'script-src',
        'effective-directive': 'script-src',
        'blocked-uri': 'https://evil.com/inject.js',
        'source-file': 'https://app.aaelink.com/main.js',
        'line-number': 42,
      },
    }
    const parsed = parseCspReport(report)
    expect(parsed).not.toBeNull()
    expect(parsed!.directive).toBe('script-src')
    expect(parsed!.blockedUri).toBe('https://evil.com/inject.js')
    expect(parsed!.sourceFile).toBe('https://app.aaelink.com/main.js')
    expect(parsed!.lineNumber).toBe(42)
  })

  it('provides defaults for missing fields', () => {
    const report: CspViolationReport = {
      'csp-report': {},
    }
    const parsed = parseCspReport(report)
    expect(parsed!.directive).toBe('unknown')
    expect(parsed!.blockedUri).toBe('unknown')
    expect(parsed!.lineNumber).toBe(0)
  })
})
