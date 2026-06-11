/**
 * Integration tests: incoming-webhook create/list/delete RBAC + audit.
 *
 * Covers the Integrations-1 security gap (parity-reference-matrix.md:341):
 *   - POST: a non-admin workspace member is denied (403 forbidden_admin_only)
 *   - POST: an owner/admin of the target workspace succeeds and an
 *           `incoming_webhook.create` audit row is written
 *   - POST: a non-member of the target workspace is denied (403)
 *   - GET:  a non-member cannot list another workspace's webhooks (403) and
 *           secret_token is never exposed in the list
 *   - DELETE: owner/admin can delete and an `incoming_webhook.delete` audit
 *           row is written; a non-admin member is denied
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, createTestChannel, asRequest,
  expectSuccess, expectError, cleanupTestData, TestContext, TestUser, TestChannel,
} from '../helpers'

let ctx: TestContext
let ownerUser: TestUser      // workspace role 'owner'
let adminMember: TestUser    // promoted to workspace role 'admin'
let plainMember: TestUser    // workspace role 'member'
let outsider: TestUser       // member of a DIFFERENT workspace only
let channel: TestChannel
let wsId: string
let otherWsId: string
const createdIds: string[] = []
const createdWebhookIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()

  ownerUser = await createTestUser(ctx.pool, { role: 'super_admin' }) // → owner
  createdIds.push(ownerUser.id)
  const { rows: [m] } = await ctx.pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.workspace_members WHERE user_id = $1 LIMIT 1`,
    [ownerUser.id]
  )
  wsId = m.workspace_id
  channel = await createTestChannel(ctx.pool, ownerUser.id, { workspaceId: wsId })

  adminMember = await createTestUser(ctx.pool, { role: 'employee' }) // → member
  createdIds.push(adminMember.id)
  await ctx.pool.query(
    `UPDATE aaelink.workspace_members SET role = 'admin' WHERE workspace_id = $1 AND user_id = $2`,
    [wsId, adminMember.id]
  )

  plainMember = await createTestUser(ctx.pool, { role: 'employee' }) // → member
  createdIds.push(plainMember.id)

  // Outsider: a true NON-member of wsId. createTestUser auto-joins every user to
  // the shared system workspace (which is wsId here), so strip that membership
  // and instead place them in a separate non-system workspace.
  outsider = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(outsider.id)
  await ctx.pool.query(
    `DELETE FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [wsId, outsider.id]
  )
  otherWsId = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system)
     VALUES ($1, $2, $3, $4, $5, false)`,
    [otherWsId, `ws-${otherWsId.slice(0, 8)}`, 'Other WS', outsider.id, Date.now()]
  )
  await ctx.pool.query(
    `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [otherWsId, outsider.id]
  )
})

afterAll(async () => {
  if (createdWebhookIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.incoming_webhooks WHERE id = ANY($1)`, [createdWebhookIds])
  }
  await ctx.pool.query(`DELETE FROM aaelink.audit_log WHERE workspace_id = ANY($1)`, [[wsId, otherWsId]])
  await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE workspace_id = $1`, [otherWsId])
  await ctx.pool.query(`DELETE FROM aaelink.workspaces WHERE id = $1`, [otherWsId])
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

async function auditCount(action: string, resourceId: string): Promise<number> {
  const { rows } = await ctx.pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM aaelink.audit_log WHERE action = $1 AND resource_id = $2`,
    [action, resourceId]
  )
  return Number(rows[0].n)
}

describe('incoming-webhooks — create RBAC + audit', () => {
  it('rejects POST without a CSRF token (403 csrf*)', async () => {
    const { POST } = await import('@/app/api/integrations/webhooks/route')
    const res = await POST(asRequest('POST', '/api/integrations/webhooks', {
      cookie: ownerUser.sessionCookie,
      body: { workspace_id: wsId, channel_id: channel.id, name: 'csrf-test-hook' },
      noAutoCsrf: true,
    }))
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error.startsWith('csrf')).toBe(true)
  })

  it('denies a non-admin workspace member (403 forbidden_admin_only)', async () => {
    const { POST } = await import('@/app/api/integrations/webhooks/route')
    const res = await POST(asRequest('POST', '/api/integrations/webhooks', {
      cookie: plainMember.sessionCookie,
      body: { workspace_id: wsId, channel_id: channel.id, name: 'denied-hook' },
    }))
    await expectError(res, 403, 'forbidden_admin_only')
  })

  it('denies a non-member of the target workspace (403)', async () => {
    const { POST } = await import('@/app/api/integrations/webhooks/route')
    const res = await POST(asRequest('POST', '/api/integrations/webhooks', {
      cookie: outsider.sessionCookie,
      body: { workspace_id: wsId, channel_id: channel.id, name: 'cross-tenant' },
    }))
    await expectError(res, 403, 'forbidden_admin_only')
  })

  it('allows an owner and writes an incoming_webhook.create audit row', async () => {
    const { POST } = await import('@/app/api/integrations/webhooks/route')
    const res = await POST(asRequest('POST', '/api/integrations/webhooks', {
      cookie: ownerUser.sessionCookie,
      body: { workspace_id: wsId, channel_id: channel.id, name: 'owner-hook' },
    }))
    const data = await expectSuccess<{ success: boolean; id: string; secret_token: string }>(res)
    expect(data.success).toBe(true)
    expect(typeof data.secret_token).toBe('string')
    expect(data.secret_token.length).toBeGreaterThan(0)
    createdWebhookIds.push(data.id)
    expect(await auditCount('incoming_webhook.create', data.id)).toBe(1)
  })

  it('allows a promoted admin member', async () => {
    const { POST } = await import('@/app/api/integrations/webhooks/route')
    const res = await POST(asRequest('POST', '/api/integrations/webhooks', {
      cookie: adminMember.sessionCookie,
      body: { workspace_id: wsId, channel_id: channel.id, name: 'admin-hook' },
    }))
    const data = await expectSuccess<{ success: boolean; id: string }>(res)
    expect(data.success).toBe(true)
    createdWebhookIds.push(data.id)
  })

  it('rejects missing required fields (400)', async () => {
    const { POST } = await import('@/app/api/integrations/webhooks/route')
    const res = await POST(asRequest('POST', '/api/integrations/webhooks', {
      cookie: ownerUser.sessionCookie,
      body: { workspace_id: wsId },
    }))
    await expectError(res, 400, 'missing_required_fields')
  })
})

describe('incoming-webhooks — list RBAC', () => {
  it('denies a non-member listing another workspace (403)', async () => {
    const { GET } = await import('@/app/api/integrations/webhooks/route')
    const res = await GET(asRequest('GET', '/api/integrations/webhooks', {
      cookie: outsider.sessionCookie,
      query: { workspace_id: wsId },
    }))
    await expectError(res, 403, 'forbidden')
  })

  it('lists for a member and never exposes secret_token', async () => {
    const { GET } = await import('@/app/api/integrations/webhooks/route')
    const res = await GET(asRequest('GET', '/api/integrations/webhooks', {
      cookie: plainMember.sessionCookie,
      query: { workspace_id: wsId },
    }))
    const data = await expectSuccess<{ webhooks: Array<Record<string, unknown>> }>(res)
    expect(Array.isArray(data.webhooks)).toBe(true)
    expect(data.webhooks.length).toBeGreaterThan(0)
    for (const w of data.webhooks) {
      expect(w).not.toHaveProperty('secret_token')
    }
  })
})

describe('incoming-webhooks — delete RBAC + audit', () => {
  async function seedWebhook(): Promise<string> {
    const id = randomUUID()
    await ctx.pool.query(
      `INSERT INTO aaelink.incoming_webhooks
         (id, workspace_id, app_id, channel_id, name, secret_token, created_by, created_at)
       VALUES ($1, $2, NULL, $3, $4, 'seed_secret', $5, $6)`,
      [id, wsId, channel.id, `del-hook-${id.slice(0, 8)}`, ownerUser.id, Date.now()]
    )
    createdWebhookIds.push(id)
    return id
  }

  it('rejects DELETE without a CSRF token (403 csrf*)', async () => {
    const id = await seedWebhook()
    const { DELETE } = await import('@/app/api/integrations/webhooks/[id]/route')
    const res = await DELETE(
      asRequest('DELETE', `/api/integrations/webhooks/${id}`, {
        cookie: ownerUser.sessionCookie,
        noAutoCsrf: true,
      }),
      { params: Promise.resolve({ id }) }
    )
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error.startsWith('csrf')).toBe(true)
  })

  it('denies a non-admin member (403)', async () => {
    const id = await seedWebhook()
    const { DELETE } = await import('@/app/api/integrations/webhooks/[id]/route')
    const res = await DELETE(
      asRequest('DELETE', `/api/integrations/webhooks/${id}`, { cookie: plainMember.sessionCookie }),
      { params: Promise.resolve({ id }) }
    )
    await expectError(res, 403, 'forbidden')
  })

  it('allows an owner and writes an incoming_webhook.delete audit row', async () => {
    const id = await seedWebhook()
    const { DELETE } = await import('@/app/api/integrations/webhooks/[id]/route')
    const res = await DELETE(
      asRequest('DELETE', `/api/integrations/webhooks/${id}`, { cookie: ownerUser.sessionCookie }),
      { params: Promise.resolve({ id }) }
    )
    await expectSuccess<{ success: boolean }>(res)
    expect(await auditCount('incoming_webhook.delete', id)).toBe(1)
    const { rows } = await ctx.pool.query(`SELECT 1 FROM aaelink.incoming_webhooks WHERE id = $1`, [id])
    expect(rows.length).toBe(0)
  })

  it('returns 404 for an unknown webhook', async () => {
    const id = randomUUID()
    const { DELETE } = await import('@/app/api/integrations/webhooks/[id]/route')
    const res = await DELETE(
      asRequest('DELETE', `/api/integrations/webhooks/${id}`, { cookie: ownerUser.sessionCookie }),
      { params: Promise.resolve({ id }) }
    )
    await expectError(res, 404, 'not_found')
  })
})
