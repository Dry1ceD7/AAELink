/**
 * AAELink — CSP Policy Builder & Report Parser Tests
 */
import { describe, it, expect } from 'vitest'
import { generateNonce, buildCspPolicy, parseCspReport } from '@/lib/csp'

describe('CSP — generateNonce', () => {
  it('returns base64 string', () => {
    const n = generateNonce()
    expect(n.length).toBeGreaterThan(10)
    expect(Buffer.from(n, 'base64').length).toBe(16)
  })
  it('unique per call', () => {
    expect(generateNonce()).not.toBe(generateNonce())
  })
})

describe('CSP — buildCspPolicy', () => {
  const nonce = 'dGVzdC1ub25jZQ=='

  it('includes nonce in script-src', () => {
    const p = buildCspPolicy(nonce)
    expect(p).toContain(`'nonce-${nonce}'`)
    expect(p).toContain('script-src')
  })

  it('includes default directives', () => {
    const p = buildCspPolicy(nonce)
    expect(p).toContain("default-src 'self'")
    expect(p).toContain("object-src 'none'")
    expect(p).toContain("base-uri 'self'")
    expect(p).toContain("form-action 'self'")
    expect(p).toContain("upgrade-insecure-requests")
  })

  it('includes google fonts in style-src', () => {
    const p = buildCspPolicy(nonce)
    expect(p).toContain('https://fonts.googleapis.com')
  })

  it('includes wss: in connect-src', () => {
    const p = buildCspPolicy(nonce)
    expect(p).toContain('wss:')
  })

  it('includes report-uri', () => {
    const p = buildCspPolicy(nonce, { reportUri: '/api/csp-report' })
    expect(p).toContain('report-uri /api/csp-report')
  })

  it('adds unsafe-eval when configured', () => {
    const p = buildCspPolicy(nonce, { allowUnsafeEval: true })
    expect(p).toContain("'unsafe-eval'")
  })

  it('does not include unsafe-eval by default', () => {
    const p = buildCspPolicy(nonce)
    expect(p).not.toContain("'unsafe-eval'")
  })

  it('adds custom trusted script sources', () => {
    const p = buildCspPolicy(nonce, { trustedScriptSrcs: ['https://cdn.example.com'] })
    expect(p).toContain('https://cdn.example.com')
  })

  it('frame-ancestors defaults to self', () => {
    const p = buildCspPolicy(nonce)
    expect(p).toContain("frame-ancestors 'self'")
  })
})

describe('CSP — parseCspReport', () => {
  it('parses valid report', () => {
    const r = parseCspReport({
      'csp-report': {
        'effective-directive': 'script-src',
        'blocked-uri': 'https://evil.com/x.js',
        'source-file': '/page.html',
        'line-number': 42,
      },
    })
    expect(r).toEqual({
      directive: 'script-src',
      blockedUri: 'https://evil.com/x.js',
      sourceFile: '/page.html',
      lineNumber: 42,
    })
  })

  it('returns null for empty body', () => {
    expect(parseCspReport({})).toBeNull()
  })

  it('defaults missing fields', () => {
    const r = parseCspReport({ 'csp-report': {} })
    expect(r?.directive).toBe('unknown')
    expect(r?.blockedUri).toBe('unknown')
    expect(r?.lineNumber).toBe(0)
  })
})
