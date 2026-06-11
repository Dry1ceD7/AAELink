/**
 * Integration tests for D2 EMM device controls + remote-wipe signaling.
 *
 * Exercises lib/enterprise/deviceManagement.ts against a live Postgres. The
 * routes (admin/emm-policy, admin/devices/[id]/wipe, devices/wipe-status) are
 * thin auth + audit wrappers over these functions.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import {
  requestRemoteWipe,
  getWipeSignal,
  acknowledgeWipe,
  getEmmPolicy,
  updateEmmPolicy,
  validateEmmPatch,
  DEFAULT_EMM_POLICY,
} from '@/lib/enterprise/deviceManagement'

let ctx: TestContext
let owner: TestUser
const userIds: string[] = []
const deviceIds: string[] = []

async function mkDevice(uid: string): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.devices (id, user_id, device_type, registered_at, last_active_at)
     VALUES ($1, $2, 'mobile', $3, $3)`,
    [id, uid, Date.now()]
  )
  deviceIds.push(id)
  return id
}

async function mkSessionForDevice(uid: string, deviceId: string): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.sessions (id, user_id, expires_at, device_id) VALUES ($1, $2, $3, $4)`,
    [id, uid, Date.now() + 86_400_000, deviceId]
  )
  return id
}

async function sessionExists(id: string): Promise<boolean> {
  const { rows } = await ctx.pool.query(`SELECT 1 FROM aaelink.sessions WHERE id = $1`, [id])
  return rows.length > 0
}

beforeAll(async () => {
  ctx = await createTestContext()
  owner = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(owner.id)
})

afterAll(async () => {
  await updateEmmPolicy(ctx.pool, { ...DEFAULT_EMM_POLICY })
  if (deviceIds.length) await ctx.pool.query(`DELETE FROM aaelink.devices WHERE id = ANY($1)`, [deviceIds])
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('requestRemoteWipe', () => {
  it('rejects an unknown device (not_found)', async () => {
    expect(await requestRemoteWipe(ctx.pool, 'ghost', owner.id)).toEqual({ ok: false, code: 'not_found' })
  })

  it('signals the wipe and revokes the device sessions', async () => {
    const dev = await mkDevice(owner.id)
    const s1 = await mkSessionForDevice(owner.id, dev)
    const s2 = await mkSessionForDevice(owner.id, dev)

    const res = await requestRemoteWipe(ctx.pool, dev, owner.id)
    expect(res).toEqual({ ok: true, deviceId: dev, sessionsRevoked: 2 })
    expect(await sessionExists(s1)).toBe(false)
    expect(await sessionExists(s2)).toBe(false)

    const signal = await getWipeSignal(ctx.pool, dev)
    expect(signal?.wipe_requested).toBe(true)
    expect(signal?.wipe_requested_at).toBeGreaterThan(0)
    expect(signal?.wiped_at).toBe(0)
  })
})

describe('getWipeSignal', () => {
  it('returns null for an unknown device and false for a quiet device', async () => {
    expect(await getWipeSignal(ctx.pool, 'ghost')).toBeNull()
    const dev = await mkDevice(owner.id)
    expect((await getWipeSignal(ctx.pool, dev))?.wipe_requested).toBe(false)
  })
})

describe('acknowledgeWipe', () => {
  it('rejects unknown and not-yet-requested devices', async () => {
    expect(await acknowledgeWipe(ctx.pool, 'ghost')).toEqual({ ok: false, code: 'not_found' })
    const dev = await mkDevice(owner.id)
    expect(await acknowledgeWipe(ctx.pool, dev)).toEqual({ ok: false, code: 'not_requested' })
  })

  it('records the acknowledgement and clears the pending signal', async () => {
    const dev = await mkDevice(owner.id)
    await requestRemoteWipe(ctx.pool, dev, owner.id)
    expect(await acknowledgeWipe(ctx.pool, dev)).toEqual({ ok: true, deviceId: dev })

    const signal = await getWipeSignal(ctx.pool, dev)
    expect(signal?.wipe_requested).toBe(false) // requested but now acknowledged
    expect(signal?.wiped_at).toBeGreaterThan(0)
  })
})

describe('EMM policy', () => {
  it('validates a patch', () => {
    expect(validateEmmPatch({ screen_lock_required: true })).toBeNull()
    expect(validateEmmPatch({ screen_lock_timeout_minutes: 5000 })?.field).toBe('screen_lock_timeout_minutes')
  })

  it('returns defaults, then persists and merges a patch', async () => {
    await ctx.pool.query(`DELETE FROM aaelink.system_config WHERE key = 'emm_policy'`)
    const def = await getEmmPolicy(ctx.pool)
    expect(def.screen_lock_required).toBe(false)

    const updated = await updateEmmPolicy(ctx.pool, { screen_lock_required: true, screen_lock_timeout_minutes: 15 })
    expect(updated.screen_lock_required).toBe(true)
    expect(updated.screen_lock_timeout_minutes).toBe(15)
    expect(updated.require_trusted_device).toBe(false) // untouched default

    const reread = await getEmmPolicy(ctx.pool)
    expect(reread.screen_lock_required).toBe(true)
  })

  it('throws on an out-of-range update', async () => {
    await expect(updateEmmPolicy(ctx.pool, { screen_lock_timeout_minutes: -1 })).rejects.toThrow()
  })
})
