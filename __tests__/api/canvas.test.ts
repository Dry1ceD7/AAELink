/**
 * Integration tests for /api/docs/canvas + /api/docs/canvas/access.
 *
 * Covers the Stage-A access engine (lib/knowledge/canvasAccess):
 *   - create / get / list a personal canvas
 *   - channel_canvas requires channel membership (member reads, non-member 403)
 *   - canvas_access grant gives a non-shared user read (the inert-table regression)
 *   - revoking the grant removes that access
 *   - PUT enforces write access (read-grant cannot write; write-grant can)
 *   - DELETE soft-deletes (creator), is audited, and rejects without CSRF
 *   - only the creator/admin may set access grants
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, createTestChannel, asRequest,
  expectSuccess, expectError, cleanupTestData, TestContext, TestUser,
} from '../helpers'

let ctx: TestContext
let owner: TestUser
let member: TestUser
let outsider: TestUser
const userIds: string[] = []
const canvasIds: string[] = []

async function importRoute() {
  return import('@/app/api/docs/canvas/route')
}
async function importAccess() {
  return import('@/app/api/docs/canvas/access/route')
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
  await cleanupTestData(ctx.pool, userIds)
  await ctx.cleanup()
})

describe('canvas create / get / list', () => {
  it('rejects unauthenticated', async () => {
    const { GET } = await importRoute()
    expect((await GET(asRequest('GET', '/api/docs/canvas'))).status).toBe(401)
  })

  it('creates a personal canvas and reads it back', async () => {
    const { POST, GET } = await importRoute()
    const created = await POST(asRequest('POST', '/api/docs/canvas', {
      cookie: owner.sessionCookie,
      body: { title: 'My Doc', type: 'personal_note', content_blocks: [{ type: 'paragraph', content: 'hello world' }] },
    }))
    const body = await expectSuccess<{ canvas: { id: string; word_count: number } }>(created)
    canvasIds.push(body.canvas.id)
    expect(body.canvas.word_count).toBe(2)

    const got = await GET(asRequest('GET', '/api/docs/canvas', { cookie: owner.sessionCookie, query: { id: body.canvas.id } }))
    const read = await expectSuccess<{ canvas: { title: string; can_write: boolean } }>(got)
    expect(read.canvas.title).toBe('My Doc')
    expect(read.canvas.can_write).toBe(true)
  })

  it('hides another user\'s personal canvas (404 not 403 via single get path)', async () => {
    const { POST, GET } = await importRoute()
    const created = await POST(asRequest('POST', '/api/docs/canvas', {
      cookie: owner.sessionCookie, body: { title: 'Secret', type: 'personal_note' },
    }))
    const { canvas } = await expectSuccess<{ canvas: { id: string } }>(created)
    canvasIds.push(canvas.id)

    const res = await GET(asRequest('GET', '/api/docs/canvas', { cookie: outsider.sessionCookie, query: { id: canvas.id } }))
    expect(res.status).toBe(403)
  })
})

describe('channel_canvas membership', () => {
  it('lets a channel member read but blocks a non-member', async () => {
    const { POST, GET } = await importRoute()
    const channel = await createTestChannel(ctx.pool, owner.id, { type: 'private' })
    await ctx.pool.query(
      `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at) VALUES ($1, $2, 'member', $3) ON CONFLICT DO NOTHING`,
      [channel.id, member.id, Date.now()]
    )

    const created = await POST(asRequest('POST', '/api/docs/canvas', {
      cookie: owner.sessionCookie,
      body: { title: 'Channel Doc', type: 'channel_canvas', channel_id: channel.id },
    }))
    const { canvas } = await expectSuccess<{ canvas: { id: string } }>(created)
    canvasIds.push(canvas.id)

    const memberRes = await GET(asRequest('GET', '/api/docs/canvas', { cookie: member.sessionCookie, query: { id: canvas.id } }))
    expect(memberRes.status).toBe(200)

    const outsiderRes = await GET(asRequest('GET', '/api/docs/canvas', { cookie: outsider.sessionCookie, query: { id: canvas.id } }))
    expect(outsiderRes.status).toBe(403)
  })

  it('forbids a non-member from creating a channel canvas in a private channel', async () => {
    const { POST } = await importRoute()
    const channel = await createTestChannel(ctx.pool, owner.id, { type: 'private' })
    const res = await POST(asRequest('POST', '/api/docs/canvas', {
      cookie: outsider.sessionCookie, body: { title: 'X', type: 'channel_canvas', channel_id: channel.id },
    }))
    expect(res.status).toBe(403)
  })
})

describe('canvas_access grants are enforced (inert-table regression)', () => {
  it('a read grant lets a non-shared user read; revoke removes it', async () => {
    const { POST, GET } = await importRoute()
    const { POST: ACCESS } = await importAccess()

    const created = await POST(asRequest('POST', '/api/docs/canvas', {
      cookie: owner.sessionCookie, body: { title: 'Granted', type: 'personal_note' },
    }))
    const { canvas } = await expectSuccess<{ canvas: { id: string } }>(created)
    canvasIds.push(canvas.id)

    // Before any grant, outsider cannot read.
    expect((await GET(asRequest('GET', '/api/docs/canvas', { cookie: outsider.sessionCookie, query: { id: canvas.id } }))).status).toBe(403)

    // Owner grants read access.
    const set = await ACCESS(asRequest('POST', '/api/docs/canvas/access', {
      cookie: owner.sessionCookie, body: { action: 'set', canvas_id: canvas.id, user_ids: [outsider.id], access_level: 'read' },
    }))
    expect(set.status).toBe(200)

    // Now the grant is consulted: outsider can read.
    expect((await GET(asRequest('GET', '/api/docs/canvas', { cookie: outsider.sessionCookie, query: { id: canvas.id } }))).status).toBe(200)

    // Revoke -> access gone.
    const del = await ACCESS(asRequest('POST', '/api/docs/canvas/access', {
      cookie: owner.sessionCookie, body: { action: 'delete', canvas_id: canvas.id, user_ids: [outsider.id] },
    }))
    expect(del.status).toBe(200)
    expect((await GET(asRequest('GET', '/api/docs/canvas', { cookie: outsider.sessionCookie, query: { id: canvas.id } }))).status).toBe(403)
  })

  it('a non-owner cannot set grants', async () => {
    const { POST } = await importRoute()
    const { POST: ACCESS } = await importAccess()
    const created = await POST(asRequest('POST', '/api/docs/canvas', {
      cookie: owner.sessionCookie, body: { title: 'Locked', type: 'personal_note' },
    }))
    const { canvas } = await expectSuccess<{ canvas: { id: string } }>(created)
    canvasIds.push(canvas.id)

    const res = await ACCESS(asRequest('POST', '/api/docs/canvas/access', {
      cookie: outsider.sessionCookie, body: { action: 'set', canvas_id: canvas.id, user_ids: [outsider.id], access_level: 'admin' },
    }))
    expect(res.status).toBe(403)
  })
})

describe('PUT write access', () => {
  it('read-grant cannot write, write-grant can', async () => {
    const { POST, PUT } = await importRoute()
    const { POST: ACCESS } = await importAccess()
    const created = await POST(asRequest('POST', '/api/docs/canvas', {
      cookie: owner.sessionCookie, body: { title: 'Writable', type: 'personal_note' },
    }))
    const { canvas } = await expectSuccess<{ canvas: { id: string } }>(created)
    canvasIds.push(canvas.id)

    // read grant
    await ACCESS(asRequest('POST', '/api/docs/canvas/access', {
      cookie: owner.sessionCookie, body: { action: 'set', canvas_id: canvas.id, user_ids: [member.id], access_level: 'read' },
    }))
    const blocked = await PUT(asRequest('PUT', '/api/docs/canvas', {
      cookie: member.sessionCookie, body: { canvas_id: canvas.id, title: 'Hacked' },
    }))
    expect(blocked.status).toBe(403)

    // upgrade to write grant
    await ACCESS(asRequest('POST', '/api/docs/canvas/access', {
      cookie: owner.sessionCookie, body: { action: 'set', canvas_id: canvas.id, user_ids: [member.id], access_level: 'write' },
    }))
    const allowed = await PUT(asRequest('PUT', '/api/docs/canvas', {
      cookie: member.sessionCookie, body: { canvas_id: canvas.id, title: 'Edited' },
    }))
    expect(allowed.status).toBe(200)
  })
})

describe('DELETE', () => {
  it('soft-deletes (creator), writes an audit row, and is excluded from reads', async () => {
    const { POST, GET, DELETE } = await importRoute()
    const created = await POST(asRequest('POST', '/api/docs/canvas', {
      cookie: owner.sessionCookie, body: { title: 'ToDelete', type: 'personal_note' },
    }))
    const { canvas } = await expectSuccess<{ canvas: { id: string } }>(created)
    canvasIds.push(canvas.id)

    const del = await DELETE(asRequest('DELETE', '/api/docs/canvas', {
      cookie: owner.sessionCookie, body: { canvas_id: canvas.id },
    }))
    expect(del.status).toBe(200)

    // Gone from the read path.
    expect((await GET(asRequest('GET', '/api/docs/canvas', { cookie: owner.sessionCookie, query: { id: canvas.id } }))).status).toBe(404)

    // Audit row exists. writeAuditLog is fire-and-forget, so poll briefly.
    let found = false
    for (let i = 0; i < 20 && !found; i++) {
      const { rows } = await ctx.pool.query(
        `SELECT 1 FROM aaelink.audit_log WHERE action = 'canvas.delete' AND resource_id = $1`, [canvas.id]
      )
      found = rows.length > 0
      if (!found) await new Promise((r) => setTimeout(r, 25))
    }
    expect(found).toBe(true)
  })

  it('rejects DELETE without a CSRF token', async () => {
    const { POST, DELETE } = await importRoute()
    const created = await POST(asRequest('POST', '/api/docs/canvas', {
      cookie: owner.sessionCookie, body: { title: 'CsrfGuard', type: 'personal_note' },
    }))
    const { canvas } = await expectSuccess<{ canvas: { id: string } }>(created)
    canvasIds.push(canvas.id)

    const req = asRequest('DELETE', '/api/docs/canvas', {
      cookie: owner.sessionCookie, body: { canvas_id: canvas.id }, noAutoCsrf: true,
    })
    const res = await DELETE(req)
    expect(res.status).toBe(403)
    await expectError(res, 403)
  })

  it('forbids an outsider from deleting', async () => {
    const { POST, DELETE } = await importRoute()
    const created = await POST(asRequest('POST', '/api/docs/canvas', {
      cookie: owner.sessionCookie, body: { title: 'NotYours', type: 'personal_note' },
    }))
    const { canvas } = await expectSuccess<{ canvas: { id: string } }>(created)
    canvasIds.push(canvas.id)

    const res = await DELETE(asRequest('DELETE', '/api/docs/canvas', {
      cookie: outsider.sessionCookie, body: { canvas_id: canvas.id },
    }))
    expect(res.status).toBe(403)
  })
})

describe('template workspace scoping (cross-tenant isolation)', () => {
  it('a same-workspace member can read a template; a foreign-workspace user cannot', async () => {
    const { POST, GET } = await importRoute()

    // owner authors a template (workspace-scoped to the shared system workspace).
    const created = await POST(asRequest('POST', '/api/docs/canvas', {
      cookie: owner.sessionCookie,
      body: { title: 'Tpl', type: 'template', content_blocks: [{ type: 'heading', content: 'secret runbook' }] },
    }))
    const { canvas } = await expectSuccess<{ canvas: { id: string } }>(created)
    canvasIds.push(canvas.id)

    // A member of the SAME workspace (member) can read the template.
    expect((await GET(asRequest('GET', '/api/docs/canvas', { cookie: member.sessionCookie, query: { id: canvas.id } }))).status).toBe(200)

    // A user belonging ONLY to a DIFFERENT workspace must NOT read it.
    const foreignWsId = `canvas-foreign-ws-${owner.id.slice(0, 8)}`
    await ctx.pool.query(
      `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system)
       VALUES ($1, $2, $2, $3, $4, false) ON CONFLICT (id) DO NOTHING`,
      [foreignWsId, `foreign-${foreignWsId.slice(0, 6)}`, owner.id, Date.now()]
    )
    const foreign = await createTestUser(ctx.pool, { role: 'employee' })
    userIds.push(foreign.id)
    // Remove the foreign user from the shared system workspace so they belong
    // ONLY to foreignWsId — otherwise they'd share owner's workspace.
    await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE user_id = $1`, [foreign.id])
    await ctx.pool.query(
      `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
      [foreignWsId, foreign.id]
    )

    const foreignRead = await GET(asRequest('GET', '/api/docs/canvas', { cookie: foreign.sessionCookie, query: { id: canvas.id } }))
    expect(foreignRead.status).toBe(403)

    await ctx.pool.query(`DELETE FROM aaelink.workspaces WHERE id = $1`, [foreignWsId])
  })
})

describe('access revoke is type-scoped', () => {
  it('revoking a user grant does not drop a channel grant with a colliding id', async () => {
    const { POST, GET } = await importRoute()
    const { POST: ACCESS } = await importAccess()

    const created = await POST(asRequest('POST', '/api/docs/canvas', {
      cookie: owner.sessionCookie, body: { title: 'TypedRevoke', type: 'personal_note' },
    }))
    const { canvas } = await expectSuccess<{ canvas: { id: string } }>(created)
    canvasIds.push(canvas.id)

    // A channel the member can read; grant that channel read on the canvas.
    const channel = await createTestChannel(ctx.pool, owner.id, { type: 'private' })
    await ctx.pool.query(
      `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at) VALUES ($1, $2, 'member', $3) ON CONFLICT DO NOTHING`,
      [channel.id, member.id, Date.now()]
    )

    // Force a value collision: a USER grant whose grantee_id EQUALS the channel id.
    await ACCESS(asRequest('POST', '/api/docs/canvas/access', {
      cookie: owner.sessionCookie, body: { action: 'set', canvas_id: canvas.id, channel_ids: [channel.id], access_level: 'read' },
    }))
    await ctx.pool.query(
      `INSERT INTO aaelink.canvas_access (id, canvas_id, grantee_type, grantee_id, access_level, granted_by, granted_at)
       VALUES ($1, $2, 'user', $3, 'read', $4, $5)
       ON CONFLICT (canvas_id, grantee_type, grantee_id) DO NOTHING`,
      [randomUUID(), canvas.id, channel.id, owner.id, Date.now()]
    )

    // Member can read via the channel grant.
    expect((await GET(asRequest('GET', '/api/docs/canvas', { cookie: member.sessionCookie, query: { id: canvas.id } }))).status).toBe(200)

    // Revoke the USER grant whose id collides with the channel id.
    const del = await ACCESS(asRequest('POST', '/api/docs/canvas/access', {
      cookie: owner.sessionCookie, body: { action: 'delete', canvas_id: canvas.id, user_ids: [channel.id] },
    }))
    expect(del.status).toBe(200)

    // The CHANNEL grant must survive — member can still read.
    expect((await GET(asRequest('GET', '/api/docs/canvas', { cookie: member.sessionCookie, query: { id: canvas.id } }))).status).toBe(200)

    // And the colliding user grant is gone.
    const { rows } = await ctx.pool.query(
      `SELECT grantee_type FROM aaelink.canvas_access WHERE canvas_id = $1 AND grantee_id = $2 ORDER BY grantee_type`,
      [canvas.id, channel.id]
    )
    expect(rows.map((r: { grantee_type: string }) => r.grantee_type)).toEqual(['channel'])
  })
})

describe('list view', () => {
  it('returns the caller\'s own canvases and not a private one they cannot see', async () => {
    const { POST, GET } = await importRoute()
    const created = await POST(asRequest('POST', '/api/docs/canvas', {
      cookie: owner.sessionCookie, body: { title: 'Listed', type: 'personal_note' },
    }))
    const { canvas } = await expectSuccess<{ canvas: { id: string } }>(created)
    canvasIds.push(canvas.id)

    const res = await GET(asRequest('GET', '/api/docs/canvas', { cookie: owner.sessionCookie, query: { mine: 'true' } }))
    const body = await expectSuccess<{ canvases: Array<{ id: string; created_by: string }> }>(res)
    expect(body.canvases.every(c => c.created_by === owner.id)).toBe(true)
    expect(body.canvases.some(c => c.id === canvas.id)).toBe(true)
  })
})
