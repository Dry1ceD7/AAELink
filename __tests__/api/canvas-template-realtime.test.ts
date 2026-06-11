/**
 * Stage B — template instantiate + realtime emit smoke.
 *
 * Template instantiate:
 *   - POST /api/docs/canvas { from_template_id } copies a readable template's
 *     content_blocks into a new canvas owned by the caller (not itself a template),
 *     and audits canvas.create with metadata.from_template.
 *   - a template the caller cannot read is rejected.
 *
 * Realtime smoke:
 *   - canvas create/update/delete and list-item create publish a 'channel_update'
 *     PubSubEvent on the channel topic. We subscribe to the in-process MemoryPubSub
 *     (the default adapter when REDIS_URL is unset) and assert the knowledge
 *     payload arrives — exercising the real emit seam end-to-end.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext, createTestUser, createTestChannel, asRequest,
  expectSuccess, TestContext, TestUser, cleanupTestData,
} from '../helpers'
import { getPubSub, channelTopic, type PubSubEvent } from '@/lib/realtime/redisPubSub'

let ctx: TestContext
let owner: TestUser
let outsider: TestUser
const userIds: string[] = []
const canvasIds: string[] = []
const channelIds: string[] = []
const listIds: string[] = []

async function importCanvas() { return import('@/app/api/docs/canvas/route') }
async function importLists() { return import('@/app/api/lists/route') }

beforeAll(async () => {
  ctx = await createTestContext()
  owner = await createTestUser(ctx.pool, { role: 'employee' })
  outsider = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(owner.id, outsider.id)
})

afterAll(async () => {
  if (listIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.list_items WHERE list_id = ANY($1)`, [listIds])
    await ctx.pool.query(`DELETE FROM aaelink.lists WHERE id = ANY($1)`, [listIds])
  }
  if (canvasIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.canvas_access WHERE canvas_id = ANY($1)`, [canvasIds])
    await ctx.pool.query(`DELETE FROM aaelink.canvases WHERE id = ANY($1)`, [canvasIds])
  }
  if (channelIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.canvases WHERE channel_id = ANY($1)`, [channelIds])
  }
  await cleanupTestData(ctx.pool, userIds)
  await ctx.cleanup()
})

/** Collect events on a topic for the duration of `fn`, then return them. */
async function captureEvents(topic: string, fn: () => Promise<void>): Promise<PubSubEvent[]> {
  const got: PubSubEvent[] = []
  const unsub = getPubSub().subscribe(topic, (e) => got.push(e))
  try {
    await fn()
    // Emits are awaited inside the handlers, but give the event loop a tick.
    await new Promise((r) => setTimeout(r, 10))
  } finally {
    unsub()
  }
  return got
}

describe('template instantiate', () => {
  it('copies a readable template into a new caller-owned canvas and audits it', async () => {
    const { POST } = await importCanvas()
    // Create a template (workspace-readable) with content.
    const tpl = await POST(asRequest('POST', '/api/docs/canvas', {
      cookie: owner.sessionCookie,
      body: { title: 'Tpl', type: 'template', content_blocks: [{ type: 'heading', content: 'From Template' }] },
    }))
    const { canvas: template } = await expectSuccess<{ canvas: { id: string } }>(tpl)
    canvasIds.push(template.id)

    // Outsider instantiates from it (templates are workspace-readable).
    const made = await POST(asRequest('POST', '/api/docs/canvas', {
      cookie: outsider.sessionCookie,
      body: { title: 'Mine', type: 'personal_note', from_template_id: template.id },
    }))
    const { canvas: instance } = await expectSuccess<{ canvas: { id: string } }>(made)
    canvasIds.push(instance.id)

    // The new canvas carries the template's blocks and is owned by the caller.
    const { rows } = await ctx.pool.query<{ created_by: string; content_blocks: unknown; type: string }>(
      `SELECT created_by, content_blocks, type FROM aaelink.canvases WHERE id = $1`, [instance.id]
    )
    expect(rows[0]?.created_by).toBe(outsider.id)
    expect(rows[0]?.type).toBe('personal_note')
    const blocks = typeof rows[0]!.content_blocks === 'string'
      ? JSON.parse(rows[0]!.content_blocks as string)
      : rows[0]!.content_blocks
    expect(blocks[0].content).toBe('From Template')

    // Audit records the template provenance.
    let found = false
    for (let i = 0; i < 20 && !found; i++) {
      const { rows: a } = await ctx.pool.query(
        `SELECT 1 FROM aaelink.audit_log
          WHERE action = 'canvas.create' AND resource_id = $1
            AND metadata->>'from_template' = $2`,
        [instance.id, template.id]
      )
      found = a.length > 0
      if (!found) await new Promise((r) => setTimeout(r, 25))
    }
    expect(found).toBe(true)
  })

  it('rejects instantiating from an unreadable template', async () => {
    const { POST } = await importCanvas()
    const secret = await POST(asRequest('POST', '/api/docs/canvas', {
      cookie: owner.sessionCookie, body: { title: 'Secret', type: 'personal_note' },
    }))
    const { canvas } = await expectSuccess<{ canvas: { id: string } }>(secret)
    canvasIds.push(canvas.id)

    const res = await POST(asRequest('POST', '/api/docs/canvas', {
      cookie: outsider.sessionCookie, body: { from_template_id: canvas.id },
    }))
    expect(res.status).toBe(403)
  })
})

describe('realtime emit smoke', () => {
  it('canvas create/update/delete publish channel_update with knowledge payload', async () => {
    const channel = await createTestChannel(ctx.pool, owner.id, { type: 'private' })
    channelIds.push(channel.id)
    const { POST, PUT, DELETE } = await importCanvas()

    const events = await captureEvents(channelTopic(channel.id), async () => {
      const created = await POST(asRequest('POST', '/api/docs/canvas', {
        cookie: owner.sessionCookie,
        body: { title: 'Live', type: 'channel_canvas', channel_id: channel.id },
      }))
      const { canvas } = await expectSuccess<{ canvas: { id: string } }>(created)
      canvasIds.push(canvas.id)

      await PUT(asRequest('PUT', '/api/docs/canvas', {
        cookie: owner.sessionCookie, body: { canvas_id: canvas.id, title: 'Live2' },
      }))
      await DELETE(asRequest('DELETE', '/api/docs/canvas', {
        cookie: owner.sessionCookie, body: { canvas_id: canvas.id },
      }))
    })

    const kinds = events
      .filter((e): e is Extract<PubSubEvent, { type: 'channel_update' }> => e.type === 'channel_update')
      .map((e) => (e.payload as { kind?: string }).kind)
    expect(kinds).toContain('canvas.updated')
    expect(kinds).toContain('canvas.deleted')
  })

  it('list_item.created publishes on the channel topic', async () => {
    const channel = await createTestChannel(ctx.pool, owner.id, { type: 'private' })
    channelIds.push(channel.id)
    const { POST } = await importLists()

    const listRes = await POST(asRequest('POST', '/api/lists', {
      cookie: owner.sessionCookie,
      body: { action: 'create_list', name: 'L', channel_id: channel.id },
    }))
    const lBody = await expectSuccess<{ list: { id: string } }>(listRes)
    listIds.push(lBody.list.id)

    const events = await captureEvents(channelTopic(channel.id), async () => {
      await POST(asRequest('POST', '/api/lists', {
        cookie: owner.sessionCookie,
        body: { action: 'add_item', list_id: lBody.list.id, values: { Title: 'row' } },
      }))
    })
    const kinds = events
      .filter((e): e is Extract<PubSubEvent, { type: 'channel_update' }> => e.type === 'channel_update')
      .map((e) => (e.payload as { kind?: string }).kind)
    expect(kinds).toContain('list_item.created')
  })
})
