/**
 * AAELink Test Helpers
 *
 * Reusable utilities for integration testing all 180 API route files.
 * Designed for Vitest + direct handler invocation (no HTTP server needed).
 *
 * Usage:
 *   import { createTestContext, createTestUser, asRequest } from '@/__tests__/helpers'
 *
 *   const ctx = await createTestContext()
 *   const user = await createTestUser(ctx.pool, { role: 'super_admin' })
 *   const req = asRequest('GET', '/api/channels', { cookie: user.sessionCookie })
 *   const res = await GET(req)
 *   expect(res.status).toBe(200)
 */

import { Pool } from 'pg'
import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'

// ── Test Context ─────────────────────────────────────────────────────

export interface TestContext {
  pool: Pool
  cleanup: () => Promise<void>
}

/**
 * Create a database-backed test context.
 * Uses the test database (or falls back to dev) with a randomized schema prefix
 * to allow parallel test execution.
 */
export async function createTestContext(): Promise<TestContext> {
  const url = process.env.TEST_DATABASE_URL
    || process.env.DATABASE_URL
    || `postgresql://aaelink:aaelink@127.0.0.1:25432/aaelink`

  const pool = new Pool({ connectionString: url, max: 5 })

  // Verify connection
  await pool.query('SELECT 1')

  // Ensure schema exists (uses the main migration)
  const { ensureSchema } = await import('@/lib/migrate')
  await ensureSchema()

  return {
    pool,
    cleanup: async () => {
      await pool.end()
    },
  }
}

// ── Test Users ───────────────────────────────────────────────────────

export interface TestUser {
  id: string
  email: string
  display_name: string
  platform_role: string
  sessionId: string
  sessionCookie: string
}

export interface CreateTestUserOptions {
  role?: 'super_admin' | 'platform_admin' | 'it_admin' | 'it_employee' | 'employee' | 'guest'
  email?: string
  displayName?: string
  department?: string
}

/**
 * Create a test user with an active session.
 * Returns user info + a session cookie string for authenticated requests.
 */
export async function createTestUser(
  pool: Pool,
  opts: CreateTestUserOptions = {}
): Promise<TestUser> {
  const id = randomUUID()
  const suffix = id.slice(0, 8)
  const email = opts.email || `test-${suffix}@aaelink.test`
  const displayName = opts.displayName || `Test User ${suffix}`
  const role = opts.role || 'employee'
  const now = Date.now()

  // Get default workspace + department
  const { rows: [ws] } = await pool.query(
    `SELECT id FROM aaelink.workspaces ORDER BY created_at LIMIT 1`
  )
  const workspaceId = ws?.id || ''

  const { rows: [dept] } = await pool.query(
    `SELECT id FROM aaelink.departments ORDER BY created_at LIMIT 1`
  )
  const departmentId = opts.department || dept?.id || ''

  // Create user
  await pool.query(`
    INSERT INTO aaelink.users (id, email, password_hash, display_name, platform_role, workspace_id, department_id, status, created_at)
    VALUES ($1, $2, 'test_hash_not_for_login', $3, $4, $5, $6, 'active', $7)
    ON CONFLICT (id) DO NOTHING
  `, [id, email, displayName, role, workspaceId, departmentId, now])

  // Create session
  const sessionId = randomUUID()
  await pool.query(`
    INSERT INTO aaelink.sessions (id, user_id, created_at, device_type, user_agent)
    VALUES ($1, $2, $3, 'test', 'vitest')
  `, [sessionId, id, now])

  return {
    id,
    email,
    display_name: displayName,
    platform_role: role,
    sessionId,
    sessionCookie: `session=${sessionId}`,
  }
}

// ── Test Channels ────────────────────────────────────────────────────

export interface TestChannel {
  id: string
  name: string
  type: string
}

export async function createTestChannel(
  pool: Pool,
  creatorId: string,
  opts: { name?: string; type?: 'public' | 'private'; workspaceId?: string } = {}
): Promise<TestChannel> {
  const id = randomUUID()
  const name = opts.name || `test-channel-${id.slice(0, 8)}`
  const type = opts.type || 'public'
  const now = Date.now()

  const { rows: [ws] } = await pool.query(
    `SELECT id FROM aaelink.workspaces ORDER BY created_at LIMIT 1`
  )
  const workspaceId = opts.workspaceId || ws?.id || ''

  await pool.query(`
    INSERT INTO aaelink.channels (id, workspace_id, name, type, created_by, created_at)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [id, workspaceId, name, type, creatorId, now])

  // Add creator as member
  await pool.query(`
    INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
    VALUES ($1, $2, 'admin', $3)
    ON CONFLICT DO NOTHING
  `, [id, creatorId, now])

  return { id, name, type }
}

// ── Test Messages ────────────────────────────────────────────────────

export async function createTestMessage(
  pool: Pool,
  channelId: string,
  userId: string,
  content: string = 'Test message'
): Promise<string> {
  const id = randomUUID()
  const now = Date.now()

  await pool.query(`
    INSERT INTO aaelink.messages (id, channel_id, user_id, content, created_at)
    VALUES ($1, $2, $3, $4, $5)
  `, [id, channelId, userId, content, now])

  return id
}

// ── Request Builder ──────────────────────────────────────────────────

/**
 * Build a NextRequest for testing route handlers.
 *
 * @param method - HTTP method
 * @param path - URL path (e.g. '/api/channels')
 * @param options - Optional headers, body, query params
 */
export function asRequest(
  method: string,
  path: string,
  options: {
    cookie?: string
    body?: Record<string, unknown>
    query?: Record<string, string>
    headers?: Record<string, string>
  } = {}
): NextRequest {
  const url = new URL(path, 'http://localhost:3040')
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      url.searchParams.set(k, v)
    }
  }

  const headers = new Headers(options.headers || {})
  if (options.cookie) headers.set('cookie', options.cookie)
  if (options.body) headers.set('content-type', 'application/json')

  return new NextRequest(url, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
}

// ── Assertions ───────────────────────────────────────────────────────

/**
 * Parse JSON response body with type safety.
 */
export async function parseResponse<T = Record<string, unknown>>(
  res: Response
): Promise<T> {
  const text = await res.text()
  try { return JSON.parse(text) as T } catch {
    throw new Error(`Failed to parse JSON response (status ${res.status}): ${text.slice(0, 200)}`)
  }
}

/**
 * Assert response is successful (2xx) and return parsed body.
 */
export async function expectSuccess<T = Record<string, unknown>>(
  res: Response
): Promise<T> {
  if (res.status < 200 || res.status >= 300) {
    const body = await res.text().catch(() => '')
    throw new Error(`Expected success but got ${res.status}: ${body.slice(0, 300)}`)
  }
  return parseResponse<T>(res)
}

/**
 * Assert response is an error with expected status.
 */
export async function expectError(
  res: Response,
  expectedStatus: number,
  expectedError?: string
): Promise<Record<string, unknown>> {
  if (res.status !== expectedStatus) {
    const body = await res.text().catch(() => '')
    throw new Error(`Expected status ${expectedStatus} but got ${res.status}: ${body.slice(0, 300)}`)
  }
  const body = await parseResponse<Record<string, unknown>>(res)
  if (expectedError && body.error !== expectedError) {
    throw new Error(`Expected error "${expectedError}" but got "${body.error}"`)
  }
  return body
}

// ── Cleanup Utilities ────────────────────────────────────────────────

/**
 * Delete test data created during a test.
 * Call in afterEach/afterAll to keep the DB clean.
 */
export async function cleanupTestData(pool: Pool, userIds: string[]) {
  if (userIds.length === 0) return
  const placeholders = userIds.map((_, i) => `$${i + 1}`).join(',')

  // Delete in dependency order
  await pool.query(`DELETE FROM aaelink.sessions WHERE user_id IN (${placeholders})`, userIds)
  await pool.query(`DELETE FROM aaelink.messages WHERE user_id IN (${placeholders})`, userIds)
  await pool.query(`DELETE FROM aaelink.channel_members WHERE user_id IN (${placeholders})`, userIds)
  await pool.query(`DELETE FROM aaelink.users WHERE id IN (${placeholders})`, userIds)
}
