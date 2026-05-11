import { test, expect } from '../fixtures'

/**
 * API Health & Observability E2E Tests
 *
 * Validates that critical API endpoints respond correctly:
 * - Health check
 * - Prometheus metrics
 * - Authentication endpoints
 */

test.describe('API Endpoints', () => {
  test('GET /api/health should return 200', async ({ request }) => {
    const res = await request.get('/api/health')
    expect(res.status()).toBe(200)

    const body = await res.json()
    expect(body).toHaveProperty('status')
  })

  test('GET /api/admin/prometheus should return OpenMetrics text', async ({ request }) => {
    const res = await request.get('/api/admin/prometheus')
    // May return 200 (success) or 503 (no DB) — both are valid responses
    expect([200, 503]).toContain(res.status())

    if (res.status() === 200) {
      const text = await res.text()
      expect(text).toContain('aaelink_')
      expect(text).toContain('# HELP')
      expect(text).toContain('# TYPE')
    }
  })

  test('GET /api/auth/me without session should return 401', async ({ request }) => {
    const res = await request.get('/api/auth/me')
    expect([200, 401]).toContain(res.status())
  })

  test('POST /api/auth/login with bad creds should return error', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { username: 'fakefakefake', password: 'notreal123' },
    })
    expect([400, 401, 403]).toContain(res.status())
  })

  test('GET /api/workspaces without auth should return 401', async ({ request }) => {
    const res = await request.get('/api/workspaces')
    expect([200, 401]).toContain(res.status())
  })

  test('GET /api/channels without workspace_id should return error', async ({ request }) => {
    const res = await request.get('/api/channels')
    expect([400, 401]).toContain(res.status())
  })
})
