/** Browser fetch with session cookies (required for Electron and strict embed contexts). */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, credentials: 'include' })
}
