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

import type { Pool } from 'pg'
import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { getPool } from '@/lib/infra/db'

// ── Test Context ─────────────────────────────────────────────────────

export interface TestContext {
  pool: Pool
  cleanup: () => Promise<void>
}

/**
 * Create a database-backed test context.
 *
 * Audit-2026-05-26 CHG-007: this used to call `new Pool({ ... max: 5 })`
 * directly, which created a parallel pool to `lib/db.ts#getPool()` and
 * meant migration / RBAC / audit-log tests ran against a different
 * connection profile than production code. The fix routes the helper
 * through `getPool()` so production and test paths share one pool. Tests
 * that need an isolated database point at it via `TEST_DATABASE_URL` and
 * we set `DATABASE_URL` from that for the lifetime of the test before
 * the first `getPool()` call.
 */
export async function createTestContext(): Promise<TestContext> {
  if (process.env.TEST_DATABASE_URL && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  }
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'postgresql://aaelink:aaelink@127.0.0.1:25432/aaelink'
  }

  const pool = getPool()
  if (!pool) {
    throw new Error('createTestContext(): getPool() returned null. Set DATABASE_URL or TEST_DATABASE_URL.')
  }

  // Verify connection
  await pool.query('SELECT 1')

  // Ensure schema exists (uses the main migration)
  const { ensureSchema } = await import('@/lib/infra/migrate')
  await ensureSchema()

  return {
    pool,
    cleanup: async () => {
      // Do NOT call pool.end() here — the pool is the singleton from
      // `lib/db.ts`. Closing it would break every other test in the suite
      // and any same-process API code that runs after this test.
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
  const username = `test_${suffix}`
  const displayName = opts.displayName || `Test User ${suffix}`
  const role = opts.role || 'employee'
  const now = Date.now()

  // Create user. The users table uses username/nickname (no display_name,
  // workspace_id, department_id, or status columns — those were refactored out).
  // Required NOT NULL columns without defaults: id, username, email,
  // password_hash, created_at.
  await pool.query(`
    INSERT INTO aaelink.users (id, username, email, password_hash, nickname, first_name, platform_role, department, created_at)
    VALUES ($1, $2, $3, 'test_hash_not_for_login', $4, $4, $5, $6, $7)
    ON CONFLICT (id) DO NOTHING
  `, [id, username, email, displayName, role, opts.department || '', now])

  // Attach to the system workspace if one exists (the seed creates it once a
  // user is present; fresh DBs may have none, which is fine for tests that
  // create their own workspaces).
  const { rows: [ws] } = await pool.query(
    `SELECT id FROM aaelink.workspaces WHERE is_system = true ORDER BY created_at LIMIT 1`
  )
  if (ws?.id) {
    await pool.query(
      `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [ws.id, id, role === 'super_admin' ? 'owner' : 'member']
    )
  }

  // Create session. All sessions columns are NOT NULL; expires_at gates
  // readSessionUserId (must be a future epoch-ms). The cookie name is
  // AAELINK_SESSION (see lib/auth/session.ts SESSION_COOKIE).
  const sessionId = randomUUID()
  await pool.query(`
    INSERT INTO aaelink.sessions (id, user_id, expires_at, user_agent, ip_address, created_at, last_active_at)
    VALUES ($1, $2, $3, 'vitest', '127.0.0.1', $4, $4)
  `, [sessionId, id, now + 86_400_000, now])

  return {
    id,
    email,
    display_name: displayName,
    platform_role: role,
    sessionId,
    sessionCookie: `AAELINK_SESSION=${sessionId}`,
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
    INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, created_by, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [id, workspaceId, name, name, type, creatorId, now])

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
    INSERT INTO aaelink.messages (id, channel_id, user_id, body, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $5)
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
