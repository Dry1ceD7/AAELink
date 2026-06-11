/**
 * Integration tests for D6 list item threads.
 *
 * Exercises lib/lists/itemThreads.ts against a live Postgres. The route
 * (app/api/lists/items/[itemId]/comments) is a thin session + CSRF wrapper.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import { addItemComment, listItemComments, deleteItemComment } from '@/lib/lists/itemThreads'

let ctx: TestContext
let creator: TestUser
let member: TestUser
let outsider: TestUser
const userIds: string[] = []
const wsIds: string[] = []
const chIds: string[] = []
const listIds: string[] = []
const itemIds: string[] = []

async function mkWorkspace(): Promise<string> {
  const id = `ws-${randomUUID().slice(0, 12)}`
  await ctx.pool.query(
    `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system)
     VALUES ($1, $1, $2, $3, $4, false)`,
    [id, `WS ${id.slice(-6)}`, creator.id, Date.now()]
  )
  wsIds.push(id)
  return id
}

async function mkChannel(wsId: string, type = 'O'): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, created_at)
     VALUES ($1, $2, $3, $3, $4, $5)`,
    [id, wsId, `ch-${id.slice(0, 8)}`, type, Date.now()]
  )
  chIds.push(id)
  return id
}

async function addChannelMember(chId: string, uid: string): Promise<void> {
  await ctx.pool.query(
    `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
     VALUES ($1, $2, 'member', $3) ON CONFLICT DO NOTHING`,
    [chId, uid, Date.now()]
  )
}

async function mkList(channelId: string): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.lists (id, workspace_id, channel_id, name, created_by, created_at, updated_at)
     VALUES ($1, '', $2, 'L', $3, $4, $4)`,
    [id, channelId, creator.id, Date.now()]
  )
  listIds.push(id)
  return id
}

async function mkItem(listId: string): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.list_items (id, list_id, position, created_by, created_at, updated_at)
     VALUES ($1, $2, 0, $3, $4, $4)`,
    [id, listId, creator.id, Date.now()]
  )
  itemIds.push(id)
  return id
}

beforeAll(async () => {
  ctx = await createTestContext()
  creator = await createTestUser(ctx.pool, { role: 'employee' })
  member = await createTestUser(ctx.pool, { role: 'employee' })
  outsider = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(creator.id, member.id, outsider.id)
})

afterAll(async () => {
  if (itemIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.list_item_comments WHERE item_id = ANY($1)`, [itemIds])
    await ctx.pool.query(`DELETE FROM aaelink.list_items WHERE id = ANY($1)`, [itemIds])
  }
  if (listIds.length) await ctx.pool.query(`DELETE FROM aaelink.lists WHERE id = ANY($1)`, [listIds])
  if (chIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.channel_members WHERE channel_id = ANY($1)`, [chIds])
    await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = ANY($1)`, [chIds])
  }
  if (wsIds.length) await ctx.pool.query(`DELETE FROM aaelink.workspaces WHERE id = ANY($1)`, [wsIds])
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('addItemComment', () => {
  it('rejects unknown item and empty body', async () => {
    expect(await addItemComment(ctx.pool, creator.id, 'nope', 'hi')).toEqual({ ok: false, code: 'not_found' })
    const ws = await mkWorkspace()
    const ch = await mkChannel(ws)
    const item = await mkItem(await mkList(ch))
    expect(await addItemComment(ctx.pool, creator.id, item, '  ')).toEqual({ ok: false, code: 'empty_body' })
  })

  it('allows any user on a public-channel list, denies non-members on a private one', async () => {
    const ws = await mkWorkspace()
    const pub = await mkChannel(ws, 'O')
    const priv = await mkChannel(ws, 'P')
    const pubItem = await mkItem(await mkList(pub))
    const privItem = await mkItem(await mkList(priv))

    expect((await addItemComment(ctx.pool, outsider.id, pubItem, 'hi')).ok).toBe(true) // public
    expect(await addItemComment(ctx.pool, outsider.id, privItem, 'hi')).toEqual({ ok: false, code: 'forbidden' })

    await addChannelMember(priv, member.id)
    expect((await addItemComment(ctx.pool, member.id, privItem, 'hi')).ok).toBe(true) // member
  })

  it('denies a non-creator on a standalone (channel-less) list', async () => {
    const item = await mkItem(await mkList('')) // standalone
    expect((await addItemComment(ctx.pool, creator.id, item, 'mine')).ok).toBe(true)
    expect(await addItemComment(ctx.pool, outsider.id, item, 'no')).toEqual({ ok: false, code: 'forbidden' })
  })
})

describe('listItemComments', () => {
  it('returns comments oldest-first and gates access', async () => {
    const ws = await mkWorkspace()
    const priv = await mkChannel(ws, 'P')
    const item = await mkItem(await mkList(priv))
    await addChannelMember(priv, member.id)
    await addItemComment(ctx.pool, member.id, item, 'first')
    await addItemComment(ctx.pool, creator.id, item, 'second')

    const res = await listItemComments(ctx.pool, creator.id, item)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.comments.map(c => c.body)).toEqual(['first', 'second'])

    expect(await listItemComments(ctx.pool, outsider.id, item)).toEqual({ ok: false, code: 'forbidden' })
  })
})

describe('deleteItemComment', () => {
  it('lets the author and the list creator delete, denies others', async () => {
    const ws = await mkWorkspace()
    const ch = await mkChannel(ws, 'O')
    const item = await mkItem(await mkList(ch))
    const byMember = await addItemComment(ctx.pool, member.id, item, 'm')
    const byOutsider = await addItemComment(ctx.pool, outsider.id, item, 'o')
    if (!byMember.ok || !byOutsider.ok) throw new Error('setup failed')

    expect(await deleteItemComment(ctx.pool, 'nope', byMember.comment.id)).toEqual({ ok: false, code: 'forbidden' })
    // list creator can delete the member's comment
    expect(await deleteItemComment(ctx.pool, creator.id, byMember.comment.id)).toEqual({ ok: true, commentId: byMember.comment.id })
    // author deletes their own
    expect(await deleteItemComment(ctx.pool, outsider.id, byOutsider.comment.id)).toEqual({ ok: true, commentId: byOutsider.comment.id })
    // already gone
    expect(await deleteItemComment(ctx.pool, creator.id, byMember.comment.id)).toEqual({ ok: false, code: 'not_found' })
  })
})
