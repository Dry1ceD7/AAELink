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

  // Guarantee a stable system workspace owned by a fixed seed user. Many routes
  // gate on workspace membership, and createTestUser attaches new users to the
  // system workspace — but the migration seed owns it via whatever the first
  // user happens to be (a transient test user), so per-test cleanup can orphan
  // or remove it. This fixed owner is never part of any test's cleanup set.
  const seedNow = Date.now()
  await pool.query(
    `INSERT INTO aaelink.users (id, username, email, password_hash, created_at)
     VALUES ('aaelink-seed-owner', '__seed_owner__', '__seed_owner__@aaelink.test', 'x', $1)
     ON CONFLICT (id) DO NOTHING`,
    [seedNow]
  )
  // created_at = 1 keeps this the OLDEST workspace, so tests that pick
  // `ORDER BY created_at LIMIT 1` always land on the system workspace (which
  // every test user is a member of) rather than a leftover fixture workspace.
  await pool.query(
    `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system)
     VALUES ('aaelink-ws-global', 'aaelink', 'AAELink', 'aaelink-seed-owner', 1, true)
     ON CONFLICT (id) DO UPDATE SET is_system = true, created_at = 1`
  )

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

// Stable fixtures for the shared system workspace. The bootstrap user owns it
// and is never added to cleanup id lists, so the workspace survives across
// suites (matching the seed's behavior) and user cleanup never hits its
// created_by FK.
const SYS_BOOTSTRAP_USER_ID = '0000000b-0007-4000-8000-00000000c0de'
const SYS_WORKSPACE_ID = 'test-system-workspace'

/** Ensure a stable, oldest, is_system workspace exists. Returns its id. Idempotent. */
export async function ensureSystemWorkspace(pool: Pool): Promise<string> {
  await pool.query(`
    INSERT INTO aaelink.users (id, username, email, password_hash, nickname, first_name, platform_role, department, created_at)
    VALUES ($1, 'test_sys_bootstrap', 'test-sys-bootstrap@aaelink.test', 'test_hash_not_for_login', 'System', 'System', 'super_admin', '', 1)
    ON CONFLICT (id) DO NOTHING
  `, [SYS_BOOTSTRAP_USER_ID])
  await pool.query(`
    INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system)
    VALUES ($1, 'system', 'System', $2, 1, true)
    ON CONFLICT (id) DO NOTHING
  `, [SYS_WORKSPACE_ID, SYS_BOOTSTRAP_USER_ID])
  return SYS_WORKSPACE_ID
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

  // Attach to the shared system workspace, creating it if absent. Many routes
  // gate on workspace membership and tests pick the oldest workspace, so this
  // must be a stable, always-present workspace the user belongs to. It is owned
  // by a fixed bootstrap user (never cleaned) and stamped created_at=1 so it is
  // always the oldest workspace; cleanupTestData never deletes is_system rows.
  const wsId = await ensureSystemWorkspace(pool)
  await pool.query(
    `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [wsId, id, role === 'super_admin' ? 'owner' : 'member']
  )

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
  const dbType = type === 'private' ? 'P' : 'O' // channels store 'O'/'P', not 'public'/'private'
  const now = Date.now()

  let workspaceId = opts.workspaceId || ''
  if (!workspaceId) {
    const { rows: [ws] } = await pool.query(
      `SELECT id FROM aaelink.workspaces ORDER BY created_at LIMIT 1`
    )
    if (ws?.id) {
      workspaceId = ws.id
    } else {
      // No workspace exists yet — create a non-system one owned by creatorId
      const wsId = randomUUID()
      const wsNow = Date.now()
      await pool.query(
        `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system)
         VALUES ($1, $2, $3, $4, $5, false)`,
        [wsId, `test-ws-${wsId.slice(0, 8)}`, `Test Workspace ${wsId.slice(0, 8)}`, creatorId, wsNow]
      )
      workspaceId = wsId
    }
  }

  await pool.query(`
    INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, created_by, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [id, workspaceId, name, name, dbType, creatorId, now])

  // Ensure the creator is a member of the channel's workspace — route reads
  // (e.g. GET /api/messages) assert workspace membership before channel access.
  await pool.query(`
    INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
    VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING
  `, [workspaceId, creatorId])

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

  // Expose the cookie to the mocked next/headers cookies() (see
  // __tests__/_setup/nextHeaders.ts) so readSessionUserId() authenticates the
  // request. Cleared when no cookie is supplied to avoid leaking across calls.
  ;(globalThis as { __TEST_COOKIE_HEADER__?: string }).__TEST_COOKIE_HEADER__ = options.cookie ?? ''

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
  // Non-system workspaces created by these users (e.g. by createTestChannel's
  // fallback) block the user delete via workspaces_created_by_fkey; remove them
  // first. NEVER delete the shared system workspace — other suites' users attach
  // to it. channels cascade off the workspace (ON DELETE CASCADE).
  await pool.query(
    `DELETE FROM aaelink.workspaces WHERE created_by IN (${placeholders}) AND is_system = false`,
    userIds
  )
  // These users may be members of workspaces created elsewhere (e.g. the system
  // workspace); that membership row references the user and must go first.
  await pool.query(`DELETE FROM aaelink.workspace_members WHERE user_id IN (${placeholders})`, userIds)
  // Tickets created by these users block the delete via tickets_created_by_fkey.
  await pool.query(`DELETE FROM aaelink.tickets WHERE created_by IN (${placeholders})`, userIds).catch(() => {})
  await pool.query(`DELETE FROM aaelink.users WHERE id IN (${placeholders})`, userIds)
}
