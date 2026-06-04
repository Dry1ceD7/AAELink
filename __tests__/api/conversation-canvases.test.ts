/**
 * Stage B — conversation-canvas consolidation + compat surface.
 *
 * Covers:
 *   1. Migration 036 conversion: a legacy conversation_canvases link (+ legacy
 *      documents row carrying a body) is converted into a channel_canvas row in
 *      aaelink.canvases whose content_blocks wrap the body, and the legacy link is
 *      tagged with migrated_canvas_id (idempotent on re-run).
 *   2. /api/conversations/canvases is now a thin compat surface over
 *      aaelink.canvases: POST creates the channel's canvas (channel-membership
 *      gated), GET returns it, a non-member is forbidden, and a second POST
 *      returns the existing canvas rather than duplicating.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, createTestChannel, asRequest,
  expectSuccess, cleanupTestData, TestContext, TestUser,
} from '../helpers'

let ctx: TestContext
let owner: TestUser
let member: TestUser
let outsider: TestUser
const userIds: string[] = []
const canvasIds: string[] = []
const channelIds: string[] = []

async function importRoute() {
  return import('@/app/api/conversations/canvases/route')
}

beforeAll(async () => {
  ctx = await createTestContext()
  owner = await createTestUser(ctx.pool, { role: 'employee' })
  member = await createTestUser(ctx.pool, { role: 'employee' })
  outsider = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(owner.id, member.id, outsider.id)
})

afterAll(async () => {
  if (canvasIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.canvas_access WHERE canvas_id = ANY($1)`, [canvasIds])
    await ctx.pool.query(`DELETE FROM aaelink.canvases WHERE id = ANY($1)`, [canvasIds])
  }
  if (channelIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.conversation_canvases WHERE channel_id = ANY($1)`, [channelIds])
    await ctx.pool.query(`DELETE FROM aaelink.canvases WHERE channel_id = ANY($1)`, [channelIds])
  }
  await cleanupTestData(ctx.pool, userIds)
  await ctx.cleanup()
})

describe('migration 036 — conversation_canvases consolidation', () => {
  it('converts a legacy link + body into a channel_canvas with blocks (idempotent)', async () => {
    const { pool } = ctx
    const channel = await createTestChannel(pool, owner.id, { type: 'private' })
    channelIds.push(channel.id)

    // The legacy table exists after the route/migration ran at least once; ensure
    // the columns the conversion reads exist (the route created it lazily before).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS aaelink.conversation_canvases (
        id TEXT PRIMARY KEY, channel_id TEXT NOT NULL UNIQUE, canvas_id TEXT NOT NULL,
        linked_by TEXT, linked_at BIGINT NOT NULL DEFAULT 0
      )
    `)
    await pool.query(`ALTER TABLE aaelink.conversation_canvases ADD COLUMN IF NOT EXISTS migrated_canvas_id TEXT`)
    // Legacy documents row needs a body column (the canonical file-storage
    // documents table has none); add it defensively for the fixture.
    await pool.query(`ALTER TABLE aaelink.documents ADD COLUMN IF NOT EXISTS body TEXT`)
    await pool.query(`ALTER TABLE aaelink.documents ADD COLUMN IF NOT EXISTS title TEXT`)

    const docId = randomUUID()
    const linkId = randomUUID()
    const now = Date.now()
    // Seed a legacy documents row with a body + a link row pointing at it.
    await pool.query(
      `INSERT INTO aaelink.documents (id, workspace_id, filename, content_type, size, bucket_key, created_at, title, body)
       VALUES ($1, 'aaelink-ws-global', 'legacy.canvas', 'text/plain', 0, $2, $3, 'Legacy Doc', 'legacy body text here')
       ON CONFLICT (id) DO NOTHING`,
      [docId, `legacy/${docId}`, now]
    )
    await pool.query(
      `INSERT INTO aaelink.conversation_canvases (id, channel_id, canvas_id, linked_by, linked_at, migrated_canvas_id)
       VALUES ($1, $2, $3, $4, $5, NULL)`,
      [linkId, channel.id, docId, owner.id, now]
    )

    // Re-run the conversion via the exported migration body (idempotent).
    const { __testConsolidateConversationCanvases } = await import('@/lib/infra/migrate')
    await __testConsolidateConversationCanvases(pool)

    const { rows: link } = await pool.query<{ migrated_canvas_id: string | null }>(
      `SELECT migrated_canvas_id FROM aaelink.conversation_canvases WHERE id = $1`, [linkId]
    )
    expect(link[0]?.migrated_canvas_id).toBeTruthy()
    const newCanvasId = link[0]!.migrated_canvas_id!
    canvasIds.push(newCanvasId)

    const { rows: cv } = await pool.query<{ type: string; channel_id: string; content_blocks: unknown }>(
      `SELECT type, channel_id, content_blocks FROM aaelink.canvases WHERE id = $1`, [newCanvasId]
    )
    expect(cv[0]?.type).toBe('channel_canvas')
    expect(cv[0]?.channel_id).toBe(channel.id)
    const blocks = typeof cv[0]!.content_blocks === 'string'
      ? JSON.parse(cv[0]!.content_blocks as string)
      : cv[0]!.content_blocks
    expect(Array.isArray(blocks)).toBe(true)
    expect(blocks[0].content).toBe('legacy body text here')

    // Idempotent: a second run does not create a second canvas.
    await __testConsolidateConversationCanvases(pool)
    const { rows: again } = await pool.query<{ migrated_canvas_id: string }>(
      `SELECT migrated_canvas_id FROM aaelink.conversation_canvases WHERE id = $1`, [linkId]
    )
    expect(again[0]?.migrated_canvas_id).toBe(newCanvasId)
  })
})

describe('/api/conversations/canvases compat surface', () => {
  it('creates the channel canvas, reads it back, and is idempotent', async () => {
    const channel = await createTestChannel(ctx.pool, owner.id, { type: 'private' })
    channelIds.push(channel.id)
    await ctx.pool.query(
      `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at) VALUES ($1, $2, 'member', $3) ON CONFLICT DO NOTHING`,
      [channel.id, member.id, Date.now()]
    )

    const { POST, GET } = await importRoute()

    const created = await POST(asRequest('POST', '/api/conversations/canvases', {
      cookie: owner.sessionCookie, body: { channel_id: channel.id, title: 'Conv Canvas' },
    }))
    const body = await expectSuccess<{ canvas_id: string }>(created)
    canvasIds.push(body.canvas_id)
    expect(body.canvas_id).toBeTruthy()

    // GET returns it for a channel member.
    const got = await GET(asRequest('GET', '/api/conversations/canvases', {
      cookie: member.sessionCookie, query: { channel_id: channel.id },
    }))
    const read = await expectSuccess<{ canvas: { id: string; type: string } | null }>(got)
    expect(read.canvas?.id).toBe(body.canvas_id)
    expect(read.canvas?.type).toBe('channel_canvas')

    // Second POST returns the existing canvas (no duplicate).
    const second = await POST(asRequest('POST', '/api/conversations/canvases', {
      cookie: owner.sessionCookie, body: { channel_id: channel.id },
    }))
    const secondBody = await expectSuccess<{ canvas_id: string; existing?: boolean }>(second)
    expect(secondBody.canvas_id).toBe(body.canvas_id)
    expect(secondBody.existing).toBe(true)
  })

  it('forbids a non-member from reading or creating', async () => {
    const channel = await createTestChannel(ctx.pool, owner.id, { type: 'private' })
    channelIds.push(channel.id)
    const { POST, GET } = await importRoute()

    expect((await GET(asRequest('GET', '/api/conversations/canvases', {
      cookie: outsider.sessionCookie, query: { channel_id: channel.id },
    }))).status).toBe(403)

    expect((await POST(asRequest('POST', '/api/conversations/canvases', {
      cookie: outsider.sessionCookie, body: { channel_id: channel.id },
    }))).status).toBe(403)
  })

  it('rejects POST without a CSRF token', async () => {
    const channel = await createTestChannel(ctx.pool, owner.id, { type: 'private' })
    channelIds.push(channel.id)
    const { POST } = await importRoute()
    const res = await POST(asRequest('POST', '/api/conversations/canvases', {
      cookie: owner.sessionCookie, body: { channel_id: channel.id }, noAutoCsrf: true,
    }))
    expect(res.status).toBe(403)
  })
})
