import { readCsrfTokenFromDocument } from '@/lib/auth/csrfClient'

/** Resolve the request pathname from any RequestInfo|URL shape. */
function requestPath(input: RequestInfo | URL): string {
  try {
    if (typeof input === 'string') return new URL(input, 'http://_').pathname
    if (input instanceof URL) return input.pathname
    if (input instanceof Request) return new URL(input.url, 'http://_').pathname
  } catch {
    // Fall through to best-effort string handling below.
  }
  const raw = typeof input === 'string' ? input : ''
  return raw.split('?')[0] || raw
}

/** True when a 401 from this path should bounce the user to /login. */
function shouldRedirectOn401(path: string): boolean {
  if (typeof window === 'undefined') return false
  // Auth endpoints legitimately return 401 (bad creds, no session yet) — never bounce.
  if (path.startsWith('/api/auth/')) return false
  // Guard against redirect loops if we are already on the login page.
  if (window.location.pathname === '/login') return false
  return true
}

/**
 * Browser fetch wrapper.
 * - Always sends session cookies (required for Electron and strict embed contexts).
 * - Automatically attaches the CSRF token header on mutating requests.
 * - On a 401 from a non-auth endpoint, redirects to /login so the user is not
 *   stranded on a silently dead page. 403 is left intact for callers to handle.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method || 'GET').toUpperCase()
  const headers = new Headers(init?.headers || {})

  // Attach CSRF token on mutating requests
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrfToken = readCsrfTokenFromDocument()
    if (csrfToken && !headers.has('x-csrf-token')) {
      headers.set('x-csrf-token', csrfToken)
    }
  }

  const res = await fetch(input, { ...init, headers, credentials: 'include' })

  if (res.status === 401 && shouldRedirectOn401(requestPath(input))) {
    window.location.assign('/login')
  }

  return res
}
