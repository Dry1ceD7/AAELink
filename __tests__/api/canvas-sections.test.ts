/**
 * Stage B — canvas sections operate on content_blocks (unified read/write).
 *
 * Covers:
 *   - create appends a block; GET sections returns it (read path = write path now)
 *   - update edits a block by id; delete removes it
 *   - reorder reorders blocks by id
 *   - optimistic concurrency: a stale expected_updated_at yields 409 stale_canvas
 *   - write access is enforced (a read-only grantee cannot mutate sections)
 *   - the legacy canvas_sections table is no longer written
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext, createTestUser, asRequest,
  expectSuccess, TestContext, TestUser, cleanupTestData,
} from '../helpers'

let ctx: TestContext
let owner: TestUser
let reader: TestUser
const userIds: string[] = []
const canvasIds: string[] = []

async function importCanvas() { return import('@/app/api/docs/canvas/route') }
async function importSections() { return import('@/app/api/docs/canvas/sections/route') }
async function importAccess() { return import('@/app/api/docs/canvas/access/route') }

beforeAll(async () => {
  ctx = await createTestContext()
  owner = await createTestUser(ctx.pool, { role: 'employee' })
  reader = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(owner.id, reader.id)
})

afterAll(async () => {
  if (canvasIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.canvas_access WHERE canvas_id = ANY($1)`, [canvasIds])
    await ctx.pool.query(`DELETE FROM aaelink.canvases WHERE id = ANY($1)`, [canvasIds])
  }
  await cleanupTestData(ctx.pool, userIds)
  await ctx.cleanup()
})

async function newCanvas(): Promise<string> {
  const { POST } = await importCanvas()
  const res = await POST(asRequest('POST', '/api/docs/canvas', {
    cookie: owner.sessionCookie, body: { title: 'Sec', type: 'personal_note' },
  }))
  const { canvas } = await expectSuccess<{ canvas: { id: string } }>(res)
  canvasIds.push(canvas.id)
  return canvas.id
}

describe('sections CRUD on content_blocks', () => {
  it('create -> list -> update -> delete a section', async () => {
    const id = await newCanvas()
    const { POST, GET } = await importSections()

    const created = await POST(asRequest('POST', '/api/docs/canvas/sections', {
      cookie: owner.sessionCookie,
      body: { action: 'create', canvas_id: id, section_type: 'heading', content: 'Intro' },
    }))
    const cBody = await expectSuccess<{ section_id: string; updated_at: number }>(created)
    expect(cBody.section_id).toBeTruthy()

    const listed = await GET(asRequest('GET', '/api/docs/canvas/sections', {
      cookie: owner.sessionCookie, query: { canvas_id: id },
    }))
    const lBody = await expectSuccess<{ sections: Array<{ id: string; content: string }> }>(listed)
    expect(lBody.sections.some(s => s.id === cBody.section_id && s.content === 'Intro')).toBe(true)

    const updated = await POST(asRequest('POST', '/api/docs/canvas/sections', {
      cookie: owner.sessionCookie,
      body: { action: 'update', canvas_id: id, section_id: cBody.section_id, content: 'Updated' },
    }))
    expect(updated.status).toBe(200)

    const afterUpdate = await GET(asRequest('GET', '/api/docs/canvas/sections', {
      cookie: owner.sessionCookie, query: { canvas_id: id },
    }))
    const auBody = await expectSuccess<{ sections: Array<{ id: string; content: string }> }>(afterUpdate)
    expect(auBody.sections.find(s => s.id === cBody.section_id)?.content).toBe('Updated')

    const deleted = await POST(asRequest('POST', '/api/docs/canvas/sections', {
      cookie: owner.sessionCookie,
      body: { action: 'delete', canvas_id: id, section_id: cBody.section_id },
    }))
    expect(deleted.status).toBe(200)

    const afterDelete = await GET(asRequest('GET', '/api/docs/canvas/sections', {
      cookie: owner.sessionCookie, query: { canvas_id: id },
    }))
    const adBody = await expectSuccess<{ sections: Array<{ id: string }> }>(afterDelete)
    expect(adBody.sections.some(s => s.id === cBody.section_id)).toBe(false)

    // The legacy canvas_sections table is no longer written.
    const { rows } = await ctx.pool.query(`SELECT 1 FROM aaelink.canvas_sections WHERE canvas_id = $1`, [id])
    expect(rows.length).toBe(0)
  })

  it('reorders sections by id', async () => {
    const id = await newCanvas()
    const { POST, GET } = await importSections()
    const ids: string[] = []
    for (const label of ['A', 'B', 'C']) {
      const r = await POST(asRequest('POST', '/api/docs/canvas/sections', {
        cookie: owner.sessionCookie, body: { action: 'create', canvas_id: id, content: label },
      }))
      const b = await expectSuccess<{ section_id: string }>(r)
      ids.push(b.section_id)
    }
    // Reverse order.
    const reordered = await POST(asRequest('POST', '/api/docs/canvas/sections', {
      cookie: owner.sessionCookie,
      body: { action: 'reorder', canvas_id: id, sections_order: [ids[2], ids[1], ids[0]] },
    }))
    expect(reordered.status).toBe(200)

    const listed = await GET(asRequest('GET', '/api/docs/canvas/sections', {
      cookie: owner.sessionCookie, query: { canvas_id: id },
    }))
    const lBody = await expectSuccess<{ sections: Array<{ id: string }> }>(listed)
    // The three created sections, in reversed order, come after the canvas's
    // default seed block.
    const order = lBody.sections.map(s => s.id).filter(x => ids.includes(x))
    expect(order).toEqual([ids[2], ids[1], ids[0]])
  })
})

describe('seed/editor blocks are addressable by id', () => {
  it('the canvas POST seed block has a stable id and can be updated by it', async () => {
    // A block created through the MAIN canvas editor (POST), not the sections API.
    const { POST: CANVAS } = await importCanvas()
    const made = await CANVAS(asRequest('POST', '/api/docs/canvas', {
      cookie: owner.sessionCookie,
      body: { title: 'Seeded', type: 'personal_note', content_blocks: [{ type: 'paragraph', content: 'seed' }] },
    }))
    const { canvas } = await expectSuccess<{ canvas: { id: string } }>(made)
    canvasIds.push(canvas.id)

    const { POST, GET } = await importSections()
    const listed = await GET(asRequest('GET', '/api/docs/canvas/sections', {
      cookie: owner.sessionCookie, query: { canvas_id: canvas.id },
    }))
    const lBody = await expectSuccess<{ sections: Array<{ id: string; content: string }> }>(listed)
    const seed = lBody.sections.find(s => s.content === 'seed')
    expect(seed?.id).toBeTruthy() // stable id present, not undefined

    // The id is persisted/stable: a section update by that id matches and applies.
    const upd = await POST(asRequest('POST', '/api/docs/canvas/sections', {
      cookie: owner.sessionCookie,
      body: { action: 'update', canvas_id: canvas.id, section_id: seed!.id, content: 'seed-edited' },
    }))
    expect(upd.status).toBe(200)

    const after = await GET(asRequest('GET', '/api/docs/canvas/sections', {
      cookie: owner.sessionCookie, query: { canvas_id: canvas.id },
    }))
    const aBody = await expectSuccess<{ sections: Array<{ id: string; content: string }> }>(after)
    expect(aBody.sections.find(s => s.id === seed!.id)?.content).toBe('seed-edited')
  })
})

describe('optimistic concurrency', () => {
  it('returns 409 stale_canvas on a stale expected_updated_at', async () => {
    const id = await newCanvas()
    const { POST } = await importSections()

    const created = await POST(asRequest('POST', '/api/docs/canvas/sections', {
      cookie: owner.sessionCookie, body: { action: 'create', canvas_id: id, content: 'x' },
    }))
    const { updated_at } = await expectSuccess<{ updated_at: number }>(created)

    // A write with an OLD updated_at (one less) must be rejected as stale.
    const stale = await POST(asRequest('POST', '/api/docs/canvas/sections', {
      cookie: owner.sessionCookie,
      body: { action: 'create', canvas_id: id, content: 'y', expected_updated_at: updated_at - 1 },
    }))
    expect(stale.status).toBe(409)
    const body = await stale.json()
    expect(body.error).toBe('stale_canvas')

    // A write with the CURRENT updated_at succeeds.
    const fresh = await POST(asRequest('POST', '/api/docs/canvas/sections', {
      cookie: owner.sessionCookie,
      body: { action: 'create', canvas_id: id, content: 'z', expected_updated_at: updated_at },
    }))
    expect(fresh.status).toBe(200)
  })
})

describe('write access enforced on sections', () => {
  it('a read-only grantee cannot mutate sections', async () => {
    const id = await newCanvas()
    const { POST: ACCESS } = await importAccess()
    const { POST } = await importSections()

    await ACCESS(asRequest('POST', '/api/docs/canvas/access', {
      cookie: owner.sessionCookie,
      body: { action: 'set', canvas_id: id, user_ids: [reader.id], access_level: 'read' },
    }))

    const res = await POST(asRequest('POST', '/api/docs/canvas/sections', {
      cookie: reader.sessionCookie, body: { action: 'create', canvas_id: id, content: 'nope' },
    }))
    expect(res.status).toBe(403)
  })
})
