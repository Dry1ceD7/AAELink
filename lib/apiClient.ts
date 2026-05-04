import { readCsrfTokenFromDocument } from '@/lib/csrfClient'

/**
 * Browser fetch wrapper.
 * - Always sends session cookies (required for Electron and strict embed contexts).
 * - Automatically attaches the CSRF token header on mutating requests.
 */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method || 'GET').toUpperCase()
  const headers = new Headers(init?.headers || {})

  // Attach CSRF token on mutating requests
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrfToken = readCsrfTokenFromDocument()
    if (csrfToken && !headers.has('x-csrf-token')) {
      headers.set('x-csrf-token', csrfToken)
    }
  }

  return fetch(input, { ...init, headers, credentials: 'include' })
}
