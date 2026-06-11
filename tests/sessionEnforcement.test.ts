/**
 * D2 Identity — session-policy enforcement helpers.
 *
 * Pure isAuthStale (force_reauth_hours) is tested directly; enforceSessionLimits
 * (max_sessions_per_user / single_session_mode) and revokeOtherUserSessions run
 * against a live Postgres, seeding raw session rows so the cap/eviction math is
 * exercised without going through the full login handler.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import type { Pool } from 'pg'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { DEFAULT_SESSION_POLICY } from '@/lib/auth/sessionPolicy'
import {
  isAuthStale,
  enforceSessionLimits,
  revokeOtherUserSessions,
} from '@/lib/auth/sessionEnforcement'

const HOUR = 3600_000
let pool: Pool
const userIds: string[] = []

async function mkUser(): Promise<string> {
  const id = randomUUID()
  await pool.query(
    `INSERT INTO aaelink.users (id, username, email, password_hash, created_at)
     VALUES ($1, $2, $3, 'x', $4)`,
    [id, `enf-${id.slice(0, 8)}`, `enf-${id.slice(0, 8)}@test.local`, Date.now()]
  )
  userIds.push(id)
  return id
}

/** Insert a session for `uid` created `ageMs` ago. Returns its id. */
async function mkSession(uid: string, ageMs: number, expired = false): Promise<string> {
  const id = randomUUID()
  const now = Date.now()
  const created = now - ageMs
  await pool.query(
    `INSERT INTO aaelink.sessions (id, user_id, expires_at, user_agent, ip_address, created_at, last_active_at)
     VALUES ($1, $2, $3, 'vitest', '127.0.0.1', $4, $4)`,
    [id, uid, expired ? now - HOUR : now + 30 * 24 * HOUR, created]
  )
  return id
}

async function liveSessionIds(uid: string): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM aaelink.sessions WHERE user_id = $1 ORDER BY created_at ASC`,
    [uid]
  )
  return rows.map(r => r.id)
}

beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  }
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'postgresql://aaelink:aaelink@127.0.0.1:25432/aaelink'
  }
  const p = getPool()
  if (!p) throw new Error('getPool() returned null')
  pool = p
  await ensureSchema()
})

afterAll(async () => {
  if (userIds.length) {
    await pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
    await pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
  }
})

describe('isAuthStale (force_reauth_hours)', () => {
  const now = 1_000_000_000_000
  it('disabled when force_reauth_hours <= 0', () => {
    const p = { ...DEFAULT_SESSION_POLICY, force_reauth_hours: 0 }
    expect(isAuthStale(p, now - 9999 * HOUR, now)).toBe(false)
  })
  it('rejects a session older than the window, accepts a fresh one', () => {
    const p = { ...DEFAULT_SESSION_POLICY, force_reauth_hours: 24 }
    expect(isAuthStale(p, now - 25 * HOUR, now)).toBe(true)
    expect(isAuthStale(p, now - 23 * HOUR, now)).toBe(false)
  })
  it('treats createdAt of 0 as not stale (unstamped legacy session)', () => {
    const p = { ...DEFAULT_SESSION_POLICY, force_reauth_hours: 1 }
    expect(isAuthStale(p, 0, now)).toBe(false)
  })
  it('default policy (168h) enforces a week-old session', () => {
    expect(isAuthStale(DEFAULT_SESSION_POLICY, now - 169 * HOUR, now)).toBe(true)
    expect(isAuthStale(DEFAULT_SESSION_POLICY, now - 167 * HOUR, now)).toBe(false)
  })
})

describe('enforceSessionLimits — cap eviction', () => {
  it('keeps newest N, evicts oldest beyond max_sessions_per_user', async () => {
    const uid = await mkUser()
    const s1 = await mkSession(uid, 4 * HOUR) // oldest
    await mkSession(uid, 3 * HOUR)
    await mkSession(uid, 2 * HOUR)
    const current = await mkSession(uid, 0) // newest / current

    await enforceSessionLimits(pool, uid, { ...DEFAULT_SESSION_POLICY, max_sessions_per_user: 2 }, current)

    const ids = await liveSessionIds(uid)
    expect(ids.length).toBe(2)
    expect(ids).toContain(current)
    expect(ids).not.toContain(s1) // oldest evicted
  })

  it('ignores expired sessions when counting toward the cap', async () => {
    const uid = await mkUser()
    await mkSession(uid, 5 * HOUR, true) // expired — should not count and should be left for the sweep
    const a = await mkSession(uid, 3 * HOUR)
    const current = await mkSession(uid, 0)

    await enforceSessionLimits(pool, uid, { ...DEFAULT_SESSION_POLICY, max_sessions_per_user: 2 }, current)

    const ids = await liveSessionIds(uid)
    // 2 active (a, current) within cap, plus the untouched expired row = 3 total rows.
    expect(ids).toContain(a)
    expect(ids).toContain(current)
    expect(ids.length).toBe(3)
  })
})

describe('enforceSessionLimits — single_session_mode', () => {
  it('revokes all sessions except the current one', async () => {
    const uid = await mkUser()
    await mkSession(uid, 3 * HOUR)
    await mkSession(uid, 2 * HOUR)
    const current = await mkSession(uid, 0)

    await enforceSessionLimits(pool, uid, { ...DEFAULT_SESSION_POLICY, single_session_mode: true }, current)

    const ids = await liveSessionIds(uid)
    expect(ids).toEqual([current])
  })
})

describe('revokeOtherUserSessions', () => {
  it('deletes every session except the kept one and returns the count', async () => {
    const uid = await mkUser()
    await mkSession(uid, 3 * HOUR)
    await mkSession(uid, 2 * HOUR)
    const keep = await mkSession(uid, 0)

    const removed = await revokeOtherUserSessions(pool, uid, keep)
    expect(removed).toBe(2)
    expect(await liveSessionIds(uid)).toEqual([keep])
  })
})
