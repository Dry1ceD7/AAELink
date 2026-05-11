/**
 * AAELink — Logger Tests
 */
import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createRequestLogger, generateTraceId, getTraceId } from '@/lib/logger'

function makeReq(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/test', { headers })
}

describe('Logger — generateTraceId', () => {
  it('returns UUID format', () => {
    const id = generateTraceId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
  })

  it('unique per call', () => {
    expect(generateTraceId()).not.toBe(generateTraceId())
  })
})

describe('Logger — getTraceId', () => {
  it('reads x-trace-id header', () => {
    const req = makeReq({ 'x-trace-id': 'custom-trace-123' })
    expect(getTraceId(req)).toBe('custom-trace-123')
  })

  it('falls back to x-request-id', () => {
    const req = makeReq({ 'x-request-id': 'req-456' })
    expect(getTraceId(req)).toBe('req-456')
  })

  it('generates UUID when no header', () => {
    const req = makeReq()
    const id = getTraceId(req)
    expect(id).toMatch(/^[0-9a-f]{8}-/)
  })
})

describe('Logger — createRequestLogger', () => {
  it('creates logger with traceId', () => {
    const log = createRequestLogger(makeReq(), '/api/test')
    expect(log.traceId).toBeTruthy()
  })

  it('uses x-trace-id header', () => {
    const log = createRequestLogger(makeReq({ 'x-trace-id': 'abc' }), '/api/test')
    expect(log.traceId).toBe('abc')
  })

  it('log methods do not throw', () => {
    const log = createRequestLogger(makeReq(), '/api/test')
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(() => log.info('test message')).not.toThrow()
    expect(() => log.warn('warn message')).not.toThrow()
    expect(() => log.error('error message')).not.toThrow()
    spy.mockRestore()
  })

  it('finish records metrics without error', () => {
    const log = createRequestLogger(makeReq(), '/api/test')
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(() => log.finish(200)).not.toThrow()
    spy.mockRestore()
  })
})
