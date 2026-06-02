/**
 * tracedRoute — security & audit-log behaviours (v0.0.27).
 *
 * `tracedRoute` is the canonical chokepoint for every API route in this
 * project. Per the 2026-05-15 audit, CSRF verification and audit-log writes
 * are uneven across the route surface (12 / 11 of 236). The fix is to lift
 * both into `tracedRoute` so wrapping a handler automatically does the right
 * thing.
 *
 * These tests pin the new behaviours so any future refactor catches a
 * regression. They run in node and stub the only externalities
 * (`lib/csrf.verifyCsrf` and `lib/auditLog.writeAuditLog`) so the wrapper's
 * decision logic is what's under test, not the implementations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// Mocks must be declared before the SUT import so vitest hoists them.
vi.mock('@/lib/auth/csrf', () => ({
  verifyCsrf: vi.fn(async () => null),
}))
vi.mock('@/lib/enterprise/auditLog', () => ({
  writeAuditLog: vi.fn(),
  extractIp: vi.fn(() => '127.0.0.1'),
}))
vi.mock('@/lib/infra/db', () => ({
  getPool: vi.fn(() => ({ query: vi.fn() })),
}))

import { tracedRoute } from '@/lib/api/tracedRoute'
import { verifyCsrf } from '@/lib/auth/csrf'
import { writeAuditLog } from '@/lib/enterprise/auditLog'

describe('tracedRoute — CSRF integration', () => {
  beforeEach(() => {
    vi.mocked(verifyCsrf).mockReset()
    vi.mocked(verifyCsrf).mockResolvedValue(null)
  })

  it('does NOT call verifyCsrf for GET requests', async () => {
    const handler = vi.fn(async () => new Response('ok'))
    const wrapped = tracedRoute('GET', '/api/things', handler)
    await wrapped(new NextRequest('http://localhost/api/things'), undefined)
    expect(verifyCsrf).not.toHaveBeenCalled()
  })

  it('calls verifyCsrf for POST requests', async () => {
    const handler = vi.fn(async () => new Response('ok'))
    const wrapped = tracedRoute('POST', '/api/things', handler)
    await wrapped(new NextRequest('http://localhost/api/things', { method: 'POST' }), undefined)
    expect(verifyCsrf).toHaveBeenCalledOnce()
  })

  it('calls verifyCsrf for PUT/PATCH/DELETE requests', async () => {
    for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
      vi.mocked(verifyCsrf).mockClear()
      const handler = vi.fn(async () => new Response('ok'))
      const wrapped = tracedRoute(method, '/api/things', handler)
      await wrapped(new NextRequest('http://localhost/api/things', { method }), undefined)
      expect(verifyCsrf, `method=${method}`).toHaveBeenCalledOnce()
    }
  })

  it('short-circuits with the CSRF response when verification fails (does NOT call handler)', async () => {
    vi.mocked(verifyCsrf).mockResolvedValueOnce(
      NextResponse.json({ error: 'csrf_token_missing' }, { status: 403 })
    )
    const handler = vi.fn(async () => new Response('should-not-run'))
    const wrapped = tracedRoute('POST', '/api/things', handler)
    const res = await wrapped(new NextRequest('http://localhost/api/things', { method: 'POST' }), undefined)
    expect(res.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })

  it('proceeds normally when verifyCsrf returns null', async () => {
    const handler = vi.fn(async () => new Response('ok', { status: 201 }))
    const wrapped = tracedRoute('POST', '/api/things', handler)
    const res = await wrapped(new NextRequest('http://localhost/api/things', { method: 'POST' }), undefined)
    expect(res.status).toBe(201)
    expect(handler).toHaveBeenCalledOnce()
  })
})

describe('tracedRoute — audit-log integration', () => {
  beforeEach(() => {
    vi.mocked(writeAuditLog).mockReset()
    vi.mocked(verifyCsrf).mockResolvedValue(null)
  })

  it('does NOT write an audit log entry for GET requests', async () => {
    const handler = vi.fn(async () => new Response('ok'))
    const wrapped = tracedRoute('GET', '/api/things', handler)
    await wrapped(new NextRequest('http://localhost/api/things'), undefined)
    expect(writeAuditLog).not.toHaveBeenCalled()
  })

  it('writes an audit log entry for successful POST requests', async () => {
    const handler = vi.fn(async () => new Response('ok', { status: 201 }))
    const wrapped = tracedRoute('POST', '/api/widgets', handler)
    await wrapped(new NextRequest('http://localhost/api/widgets', { method: 'POST' }), undefined)
    expect(writeAuditLog).toHaveBeenCalledOnce()
    const entry = vi.mocked(writeAuditLog).mock.calls[0][0]
    expect(entry.action).toBe('http.post.api.widgets')
    expect(entry.metadata).toMatchObject({ status: 201, method: 'POST', route: '/api/widgets' })
  })

  it('captures the ip and user-agent from the request', async () => {
    const handler = vi.fn(async () => new Response('ok'))
    const wrapped = tracedRoute('PATCH', '/api/widgets', handler)
    const req = new NextRequest('http://localhost/api/widgets', {
      method: 'PATCH',
      headers: { 'user-agent': 'vitest/1.0', 'x-forwarded-for': '203.0.113.42' },
    })
    await wrapped(req, undefined)
    const entry = vi.mocked(writeAuditLog).mock.calls[0][0]
    expect(entry.userAgent).toBe('vitest/1.0')
    // extractIp is mocked to '127.0.0.1' — we only assert it was passed.
    expect(typeof entry.ipAddress).toBe('string')
  })

  it('marks the audit entry with the response status, including failures', async () => {
    const handler = vi.fn(async () => new Response('forbidden', { status: 403 }))
    const wrapped = tracedRoute('DELETE', '/api/widgets/1', handler)
    await wrapped(new NextRequest('http://localhost/api/widgets/1', { method: 'DELETE' }), undefined)
    const entry = vi.mocked(writeAuditLog).mock.calls[0][0]
    expect(entry.metadata).toMatchObject({ status: 403, success: false })
  })

  it('records a failed audit entry when the handler throws', async () => {
    const handler = vi.fn(async () => { throw new Error('boom') })
    const wrapped = tracedRoute('POST', '/api/widgets', handler)
    await wrapped(new NextRequest('http://localhost/api/widgets', { method: 'POST' }), undefined)
    expect(writeAuditLog).toHaveBeenCalledOnce()
    const entry = vi.mocked(writeAuditLog).mock.calls[0][0]
    expect(entry.metadata).toMatchObject({ status: 500, success: false })
    expect(String(entry.metadata?.error)).toContain('boom')
  })

  it('does NOT write an audit entry for CSRF-rejected requests', async () => {
    vi.mocked(verifyCsrf).mockResolvedValueOnce(
      NextResponse.json({ error: 'csrf_token_missing' }, { status: 403 })
    )
    const handler = vi.fn(async () => new Response('should-not-run'))
    const wrapped = tracedRoute('POST', '/api/widgets', handler)
    await wrapped(new NextRequest('http://localhost/api/widgets', { method: 'POST' }), undefined)
    // CSRF rejection happens before any business logic — auditing it would
    // explode the table on a token leak. The CSRF route already has its own
    // 403 metric / span, so we deliberately do not duplicate.
    expect(writeAuditLog).not.toHaveBeenCalled()
  })
})
