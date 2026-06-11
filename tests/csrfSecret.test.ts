/**
 * Regression test for audit finding CRIT-001 (audit-2026-05-26).
 *
 * `lib/csrf.ts` MUST refuse to sign / verify a token in production when
 * `CSRF_SECRET` is not set. The pre-fix behavior fell back to a literal
 * committed to the repo, which let any reader of the source forge valid
 * CSRF tokens.
 *
 * The 2026-05-26 fix resolves the secret lazily on first use. This test
 * exercises that path: importing the module is a no-op; calling a
 * sign-or-verify path is what triggers the guard.
 */

import { describe, it, expect, afterEach } from 'vitest'
import {
  setCsrfCookie,
  __resetCsrfSecretForTests,
} from '@/lib/auth/csrf'

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, key)
  } else {
    Reflect.set(process.env, key, value)
  }
}

describe('lib/csrf — CSRF_SECRET enforcement (CRIT-001)', () => {
  const originalNodeEnv = process.env.NODE_ENV
  const originalSecret = process.env.CSRF_SECRET

  afterEach(() => {
    setEnv('NODE_ENV', originalNodeEnv)
    setEnv('CSRF_SECRET', originalSecret)
    __resetCsrfSecretForTests()
  })

  it('throws on first sign in production when CSRF_SECRET is unset', async () => {
    setEnv('NODE_ENV', 'production')
    setEnv('CSRF_SECRET', undefined)
    __resetCsrfSecretForTests()

    // `setCsrfCookie()` is the first sign path. Before the lazy-resolution
    // fix, the throw fired at module load time and broke `next build`. Now
    // it fires only when a request actually tries to mint a token.
    await expect(setCsrfCookie()).rejects.toThrow(/CSRF_SECRET is required in production/)
  })

  it('does not throw in development when CSRF_SECRET is unset', async () => {
    setEnv('NODE_ENV', 'development')
    setEnv('CSRF_SECRET', undefined)
    __resetCsrfSecretForTests()

    // setCsrfCookie() in dev mints a token using an ephemeral secret. The
    // call may still fail because there is no live request scope (no
    // `next/headers` cookies()), but it MUST NOT fail with the production
    // CSRF_SECRET-required guard.
    let threw: Error | null = null
    try {
      await setCsrfCookie()
    } catch (err) {
      threw = err instanceof Error ? err : new Error(String(err))
    }
    if (threw) {
      expect(threw.message).not.toMatch(/CSRF_SECRET is required in production/)
    }
  })

  it('uses CSRF_SECRET when provided in production', async () => {
    setEnv('NODE_ENV', 'production')
    setEnv('CSRF_SECRET', 'a'.repeat(64))
    __resetCsrfSecretForTests()

    // Same shape: the call may fail for missing request scope but MUST NOT
    // fail with the secret-required guard.
    let threw: Error | null = null
    try {
      await setCsrfCookie()
    } catch (err) {
      threw = err instanceof Error ? err : new Error(String(err))
    }
    if (threw) {
      expect(threw.message).not.toMatch(/CSRF_SECRET is required in production/)
    }
  })
})
