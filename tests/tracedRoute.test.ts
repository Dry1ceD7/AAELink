/**
 * AAELink — Traced Route Tests
 */
import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { tracedRoute } from '@/lib/api/tracedRoute'

describe('TracedRoute', () => {
  it('passes request to handler and returns response', async () => {
    const handler = vi.fn(async () => new Response('ok', { status: 200 }))
    const wrapped = tracedRoute('GET', '/api/test', handler)
    const req = new NextRequest('http://localhost/api/test')
    const res = await wrapped(req, undefined)
    expect(handler).toHaveBeenCalledOnce()
    expect(res.status).toBe(200)
  })

  it('injects traceparent header in response', async () => {
    const handler = vi.fn(async () => new Response('ok', { status: 200 }))
    const wrapped = tracedRoute('POST', '/api/test', handler)
    const req = new NextRequest('http://localhost/api/test', { method: 'POST' })
    const res = await wrapped(req, undefined)
    expect(res.headers.has('traceparent')).toBe(true)
  })

  it('returns 500 on handler error', async () => {
    const handler = vi.fn(async () => { throw new Error('boom') })
    const wrapped = tracedRoute('GET', '/api/fail', handler)
    const req = new NextRequest('http://localhost/api/fail')
    const res = await wrapped(req, undefined)
    expect(res.status).toBe(500)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('internal_server_error')
  })

  it('preserves original status code', async () => {
    const handler = vi.fn(async () => new Response('not found', { status: 404 }))
    const wrapped = tracedRoute('GET', '/api/missing', handler)
    const req = new NextRequest('http://localhost/api/missing')
    const res = await wrapped(req, undefined)
    expect(res.status).toBe(404)
  })

  it('passes ctx argument through', async () => {
    const handler = vi.fn(async (_req: NextRequest, ctx: { params: { id: string } }) => {
      return new Response(JSON.stringify(ctx), { status: 200 })
    })
    const wrapped = tracedRoute('GET', '/api/ctx', handler)
    const req = new NextRequest('http://localhost/api/ctx')
    const ctx = { params: { id: '42' } }
    await wrapped(req, ctx)
    expect(handler).toHaveBeenCalledWith(req, ctx)
  })
})
