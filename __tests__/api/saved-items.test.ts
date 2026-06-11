/**
 * Integration tests for D3 saved / "Later" items.
 *
 * Exercises lib/messaging/savedItems.ts against a live Postgres. The route
 * (app/api/saved-items) is a thin session + CSRF wrapper over these functions.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import {
  saveItem,
  unsaveItem,
  setSavedItemState,
  listSavedItems,
} from '@/lib/messaging/savedItems'

let ctx: TestContext
let owner: TestUser
let outsider: TestUser
const userIds: string[] = []
const wsIds: string[] = []
const chIds: string[] = []
const msgIds: string[] = []

async function mkWorkspace(): Promise<string> {
  const id = `ws-${randomUUID().slice(0, 12)}`
  await ctx.pool.query(
    `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system)
     VALUES ($1, $1, $2, $3, $4, false)`,
    [id, `WS ${id.slice(-6)}`, owner.id, Date.now()]
  )
  wsIds.push(id)
  return id
}

async function mkChannel(wsId: string): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, created_at)
     VALUES ($1, $2, $3, $3, 'O', $4)`,
    [id, wsId, `ch-${id.slice(0, 8)}`, Date.now()]
  )
  chIds.push(id)
  return id
}

async function addWorkspaceMember(wsId: string, uid: string): Promise<void> {
  await ctx.pool.query(
    `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
    [wsId, uid]
  )
}

async function addChannelMember(chId: string, uid: string): Promise<void> {
  await ctx.pool.query(
    `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
     VALUES ($1, $2, 'member', $3) ON CONFLICT DO NOTHING`,
    [chId, uid, Date.now()]
  )
}

async function mkMessage(chId: string, uid: string, body = 'hello'): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '', $5, $5)`,
    [id, chId, uid, body, Date.now()]
  )
  msgIds.push(id)
  return id
}

beforeAll(async () => {
  ctx = await createTestContext()
  owner = await createTestUser(ctx.pool, { role: 'employee' })
  outsider = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(owner.id, outsider.id)
})

afterAll(async () => {
  if (msgIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.saved_items WHERE message_id = ANY($1)`, [msgIds])
    await ctx.pool.query(`DELETE FROM aaelink.messages WHERE id = ANY($1)`, [msgIds])
  }
  if (chIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.channel_members WHERE channel_id = ANY($1)`, [chIds])
    await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = ANY($1)`, [chIds])
  }
  if (wsIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE workspace_id = ANY($1)`, [wsIds])
    await ctx.pool.query(`DELETE FROM aaelink.workspaces WHERE id = ANY($1)`, [wsIds])
  }
  await ctx.pool.query(`DELETE FROM aaelink.saved_items WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('saveItem', () => {
  it('rejects an unknown message (not_found)', async () => {
    expect(await saveItem(ctx.pool, owner.id, 'nope')).toEqual({ ok: false, code: 'not_found' })
  })

  it('rejects a message in a channel the user is not a member of (forbidden)', async () => {
    const ws = await mkWorkspace()
    await addWorkspaceMember(ws, owner.id)
    // outsider is NOT added to the workspace, so userCanReadChannel returns false
    const ch = await mkChannel(ws)
    await addChannelMember(ch, owner.id)
    const msg = await mkMessage(ch, owner.id)
    expect(await saveItem(ctx.pool, outsider.id, msg)).toEqual({ ok: false, code: 'forbidden' })
  })

  it('saves a visible message and is idempotent (re-save keeps state)', async () => {
    const ws = await mkWorkspace()
    await addWorkspaceMember(ws, owner.id)
    const ch = await mkChannel(ws)
    await addChannelMember(ch, owner.id)
    const msg = await mkMessage(ch, owner.id)

    expect(await saveItem(ctx.pool, owner.id, msg)).toEqual({ ok: true, messageId: msg })
    await setSavedItemState(ctx.pool, owner.id, msg, 'in_progress')
    expect(await saveItem(ctx.pool, owner.id, msg)).toEqual({ ok: true, messageId: msg }) // re-save

    const items = await listSavedItems(ctx.pool, owner.id)
    expect(items.find(i => i.message_id === msg)?.state).toBe('in_progress') // preserved
  })
})

describe('setSavedItemState', () => {
  it('rejects an invalid state and a non-saved message', async () => {
    const ws = await mkWorkspace()
    await addWorkspaceMember(ws, owner.id)
    const ch = await mkChannel(ws)
    await addChannelMember(ch, owner.id)
    const msg = await mkMessage(ch, owner.id)

    expect(await setSavedItemState(ctx.pool, owner.id, msg, 'bogus')).toEqual({ ok: false, code: 'invalid_state' })
    expect(await setSavedItemState(ctx.pool, owner.id, msg, 'completed')).toEqual({ ok: false, code: 'not_found' })

    await saveItem(ctx.pool, owner.id, msg)
    expect(await setSavedItemState(ctx.pool, owner.id, msg, 'completed')).toEqual({ ok: true, messageId: msg, state: 'completed' })
  })
})

describe('listSavedItems', () => {
  it('filters by state, carries a message snapshot, and is per-user', async () => {
    const ws = await mkWorkspace()
    await addWorkspaceMember(ws, owner.id)
    const ch = await mkChannel(ws)
    await addChannelMember(ch, owner.id)
    const a = await mkMessage(ch, owner.id, 'alpha')
    const b = await mkMessage(ch, owner.id, 'beta')
    await saveItem(ctx.pool, owner.id, a)
    await saveItem(ctx.pool, owner.id, b)
    await setSavedItemState(ctx.pool, owner.id, b, 'archived')

    const all = await listSavedItems(ctx.pool, owner.id)
    expect(all.map(i => i.message_id)).toEqual(expect.arrayContaining([a, b]))
    const snap = all.find(i => i.message_id === a)
    expect(snap?.body).toBe('alpha')
    expect(snap?.channel_id).toBe(ch)

    const archived = await listSavedItems(ctx.pool, owner.id, 'archived')
    expect(archived.map(i => i.message_id)).toContain(b)
    expect(archived.map(i => i.message_id)).not.toContain(a)

    expect(await listSavedItems(ctx.pool, outsider.id)).toEqual([])
  })
})

describe('unsaveItem', () => {
  it('removes a saved item and reports missing ones', async () => {
    const ws = await mkWorkspace()
    await addWorkspaceMember(ws, owner.id)
    const ch = await mkChannel(ws)
    await addChannelMember(ch, owner.id)
    const msg = await mkMessage(ch, owner.id)
    await saveItem(ctx.pool, owner.id, msg)

    expect(await unsaveItem(ctx.pool, owner.id, msg)).toBe(true)
    expect(await unsaveItem(ctx.pool, owner.id, msg)).toBe(false)
  })
})
