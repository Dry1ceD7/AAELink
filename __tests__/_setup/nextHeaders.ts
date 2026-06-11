/**
 * Test harness shim for `next/headers`.
 *
 * Route handlers resolve the caller via `readSessionUserId()`, which calls
 * `cookies()` from next/headers. Outside a real Next request scope (i.e. when a
 * handler is invoked directly in vitest) `cookies()` throws, so every
 * cookie-authenticated route returned 500 in tests.
 *
 * This mock makes `cookies().get(name)` read from a process-global cookie header
 * that `asRequest` (see __tests__/helpers.ts) sets from its `cookie` option, so
 * a request built with `{ cookie: user.sessionCookie }` authenticates exactly as
 * it would in production. Files run sequentially (fileParallelism: false) and
 * tests within a file run in order, so the single global is race-free.
 */
import { vi } from 'vitest'

// Deterministic CSRF secret so asRequest's auto-attached token verifies against
// lib/auth/csrf (verifyCsrf is fail-closed for authenticated mutating requests).
process.env.CSRF_SECRET = process.env.CSRF_SECRET || 'test-csrf-secret'

function readCookie(name: string): { name: string; value: string } | undefined {
  const header = (globalThis as { __TEST_COOKIE_HEADER__?: string }).__TEST_COOKIE_HEADER__ || ''
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === name) {
      return { name, value: decodeURIComponent(part.slice(eq + 1).trim()) }
    }
  }
  return undefined
}

vi.mock('next/headers', () => {
  const cookieStore = {
    get: (name: string) => readCookie(name),
    getAll: () => {
      const header = (globalThis as { __TEST_COOKIE_HEADER__?: string }).__TEST_COOKIE_HEADER__ || ''
      return header
        .split(/;\s*/)
        .map(p => {
          const eq = p.indexOf('=')
          return eq < 0 ? null : { name: p.slice(0, eq).trim(), value: decodeURIComponent(p.slice(eq + 1).trim()) }
        })
        .filter(Boolean)
    },
    has: (name: string) => readCookie(name) !== undefined,
    set: () => { /* no-op: handlers set cookies via NextResponse */ },
    delete: () => { /* no-op */ },
  }
  return {
    cookies: async () => cookieStore,
    headers: async () => new Headers(),
    draftMode: async () => ({ isEnabled: false, enable: () => {}, disable: () => {} }),
  }
})
