/**
 * Client-side CSRF token reader.
 * Reads the CSRF cookie from document.cookie so apiFetch can attach it.
 */

const CSRF_COOKIE = 'AAELINK_CSRF'

export function readCsrfTokenFromDocument(): string {
  if (typeof document === 'undefined') return ''
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`))
  return match?.[1] || ''
}
