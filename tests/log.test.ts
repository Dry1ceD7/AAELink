/**
 * `lib/log.ts` regression suite.
 *
 * The logger reads env vars at module-load time, so each test that needs a
 * different log level imports a fresh module via dynamic `await import()`.
 * Pure smoke + level-gating coverage — fancy formatters not yet present.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('log — basic shape', () => {
  it('exposes debug/info/warn/error methods', async () => {
    const { log } = await import('@/lib/infra/log')
    expect(typeof log.debug).toBe('function')
    expect(typeof log.info).toBe('function')
    expect(typeof log.warn).toBe('function')
    expect(typeof log.error).toBe('function')
  })
})

describe('log — level gating (default level = debug in test env)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.resetModules()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('routes warn() to console.warn', async () => {
    const { log } = await import('@/lib/infra/log')
    log.warn('something went sideways')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toContain('something went sideways')
  })

  it('routes error() to console.error', async () => {
    const { log } = await import('@/lib/infra/log')
    log.error('boom')
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0][0]).toContain('boom')
  })

  it('routes info() to console.log', async () => {
    const { log } = await import('@/lib/infra/log')
    log.info('hello')
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy.mock.calls[0][0]).toContain('hello')
  })

  it('renders the `name` field as a level:name tag', async () => {
    const { log } = await import('@/lib/infra/log')
    log.info('x', { name: 'realtime.connect' })
    expect(logSpy.mock.calls[0][0]).toContain('[info:realtime.connect]')
  })

  it('appends extra fields as JSON', async () => {
    const { log } = await import('@/lib/infra/log')
    log.warn('rate limit', { name: 'api.rateLimit', count: 42 })
    const out = warnSpy.mock.calls[0][0] as string
    expect(out).toContain('[warn:api.rateLimit]')
    expect(out).toContain('"count":42')
  })
})
