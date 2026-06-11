/**
 * Integration tests for /api/admin/retention/channels — per-channel retention
 * overrides (Slack admin.conversations.setCustomRetention parity, Admin 14).
 *
 * Coverage:
 *   - RBAC: 401 (no session) / 403 (non-admin) on GET, PUT, DELETE
 *   - PUT upserts an override (set then update same channel)
 *   - PUT validation: invalid_channel_id, invalid_retention_days, channel_not_found
 *   - GET list + GET single (?channel_id) + 404 for an unknown channel
 *   - DELETE clears + 404 when already absent
 *   - writes land an audit_log row
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext, createTestUser, createTestChannel, asRequest, cleanupTestData,
  TestContext, TestUser, TestChannel,
} from '../helpers'

let ctx: TestContext
let admin: TestUser
let employee: TestUser
let channel: TestChannel
const userIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  employee = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(admin.id, employee.id)
  channel = await createTestChannel(ctx.pool, admin.id)
})

afterAll(async () => {
  await ctx.pool.query(
    `DELETE FROM aaelink.channel_retention_overrides WHERE channel_id = $1`, [channel.id]
  ).catch(() => {})
  await cleanupTestData(ctx.pool, userIds)
  await ctx.cleanup()
})

describe('/api/admin/retention/channels — RBAC', () => {
  it('GET 401 without a session', async () => {
    const { GET } = await import('@/app/api/admin/retention/channels/route')
    const res = await GET(asRequest('GET', '/api/admin/retention/channels'))
    expect(res.status).toBe(401)
  })

  it('GET 403 for a non-admin', async () => {
    const { GET } = await import('@/app/api/admin/retention/channels/route')
    const res = await GET(asRequest('GET', '/api/admin/retention/channels', {
      cookie: employee.sessionCookie,
    }))
    expect(res.status).toBe(403)
  })

  it('PUT 403 for a non-admin', async () => {
    const { PUT } = await import('@/app/api/admin/retention/channels/route')
    const res = await PUT(asRequest('PUT', '/api/admin/retention/channels', {
      cookie: employee.sessionCookie,
      body: { channel_id: channel.id, retention_days: 7 },
    }))
    expect(res.status).toBe(403)
  })

  it('DELETE 403 for a non-admin', async () => {
    const { DELETE } = await import('@/app/api/admin/retention/channels/route')
    const res = await DELETE(asRequest('DELETE', '/api/admin/retention/channels', {
      cookie: employee.sessionCookie,
      query: { channel_id: channel.id },
    }))
    expect(res.status).toBe(403)
  })
})

describe('/api/admin/retention/channels — PUT validation', () => {
  it('rejects a missing channel_id', async () => {
    const { PUT } = await import('@/app/api/admin/retention/channels/route')
    const res = await PUT(asRequest('PUT', '/api/admin/retention/channels', {
      cookie: admin.sessionCookie, body: { retention_days: 7 },
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_channel_id')
  })

  it('rejects a negative retention_days', async () => {
    const { PUT } = await import('@/app/api/admin/retention/channels/route')
    const res = await PUT(asRequest('PUT', '/api/admin/retention/channels', {
      cookie: admin.sessionCookie, body: { channel_id: channel.id, retention_days: -1 },
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_retention_days')
  })

  it('rejects an unknown channel', async () => {
    const { PUT } = await import('@/app/api/admin/retention/channels/route')
    const res = await PUT(asRequest('PUT', '/api/admin/retention/channels', {
      cookie: admin.sessionCookie,
      body: { channel_id: 'no-such-channel', retention_days: 7 },
    }))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('channel_not_found')
  })
})

describe('/api/admin/retention/channels — CRUD + audit', () => {
  it('PUT sets then upserts (updates) an override', async () => {
    const { PUT } = await import('@/app/api/admin/retention/channels/route')
    const set = await PUT(asRequest('PUT', '/api/admin/retention/channels', {
      cookie: admin.sessionCookie,
      body: { channel_id: channel.id, retention_days: 7, enabled: true },
    }))
    expect(set.status).toBe(200)
    const setBody = (await set.json()) as { override: { retention_days: number; enabled: boolean } }
    expect(setBody.override.retention_days).toBe(7)
    expect(setBody.override.enabled).toBe(true)

    const upd = await PUT(asRequest('PUT', '/api/admin/retention/channels', {
      cookie: admin.sessionCookie,
      body: { channel_id: channel.id, retention_days: 30, enabled: false },
    }))
    expect(upd.status).toBe(200)
    const updBody = (await upd.json()) as { override: { retention_days: number; enabled: boolean } }
    expect(updBody.override.retention_days).toBe(30)
    expect(updBody.override.enabled).toBe(false)

    // exactly one row (upsert, not duplicate insert)
    const { rows } = await ctx.pool.query(
      `SELECT count(*)::int AS n FROM aaelink.channel_retention_overrides WHERE channel_id = $1`,
      [channel.id]
    )
    expect(rows[0].n).toBe(1)
  })

  it('GET single returns the override; list includes it', async () => {
    const { GET } = await import('@/app/api/admin/retention/channels/route')
    const one = await GET(asRequest('GET', '/api/admin/retention/channels', {
      cookie: admin.sessionCookie, query: { channel_id: channel.id },
    }))
    expect(one.status).toBe(200)
    expect((await one.json()).override.channel_id).toBe(channel.id)

    const list = await GET(asRequest('GET', '/api/admin/retention/channels', {
      cookie: admin.sessionCookie,
    }))
    expect(list.status).toBe(200)
    const listBody = (await list.json()) as { overrides: Array<{ channel_id: string }> }
    expect(listBody.overrides.some((o) => o.channel_id === channel.id)).toBe(true)
  })

  it('GET single 404 for an unknown channel', async () => {
    const { GET } = await import('@/app/api/admin/retention/channels/route')
    const res = await GET(asRequest('GET', '/api/admin/retention/channels', {
      cookie: admin.sessionCookie, query: { channel_id: 'no-such-channel' },
    }))
    expect(res.status).toBe(404)
  })

  it('writes an audit row on set', async () => {
    const { rows } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.audit_log
        WHERE action = 'retention.channel_override.set' AND resource_id = $1 LIMIT 1`,
      [channel.id]
    )
    expect(rows.length).toBe(1)
  })

  it('DELETE clears the override, then 404 when already absent', async () => {
    const { DELETE } = await import('@/app/api/admin/retention/channels/route')
    const del = await DELETE(asRequest('DELETE', '/api/admin/retention/channels', {
      cookie: admin.sessionCookie, query: { channel_id: channel.id },
    }))
    expect(del.status).toBe(200)
    expect((await del.json()).cleared).toBe(true)

    const again = await DELETE(asRequest('DELETE', '/api/admin/retention/channels', {
      cookie: admin.sessionCookie, query: { channel_id: channel.id },
    }))
    expect(again.status).toBe(404)
  })
})
