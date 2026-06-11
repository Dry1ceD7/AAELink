/**
 * AAELink — WebAuthn RP config derivation (pure, no DB).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { rpConfig } from '@/lib/auth/webauthn'

const ORIG = process.env.NEXT_PUBLIC_APP_URL

afterEach(() => {
  if (ORIG === undefined) delete process.env.NEXT_PUBLIC_APP_URL
  else process.env.NEXT_PUBLIC_APP_URL = ORIG
})

describe('rpConfig', () => {
  it('derives rpID (hostname) and origin from NEXT_PUBLIC_APP_URL', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://chat.aae.co.th'
    const c = rpConfig()
    expect(c.rpID).toBe('chat.aae.co.th')
    expect(c.origin).toBe('https://chat.aae.co.th')
    expect(c.rpName).toBe('AAELink')
  })

  it('strips port from rpID but keeps it in origin', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://chat.aae.co.th:8443'
    const c = rpConfig()
    expect(c.rpID).toBe('chat.aae.co.th')
    expect(c.origin).toBe('https://chat.aae.co.th:8443')
  })

  it('falls back to localhost dev origin when unset', () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    const c = rpConfig()
    expect(c.rpID).toBe('localhost')
    expect(c.origin).toBe('http://localhost:3040')
  })
})
