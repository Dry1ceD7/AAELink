/**
 * Integration tests for D3 message edit history.
 *
 * Exercises lib/messaging/messageEdits.ts against a live Postgres. The route
 * (app/api/messages/[id]/edits) is a thin session + channel-visibility wrapper,
 * and capture is wired into the message PATCH handler.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import { recordMessageEdit, listMessageEdits, messageEditCount } from '@/lib/messaging/messageEdits'

let ctx: TestContext
let owner: TestUser
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

async function mkMessage(chId: string, uid: string, body = 'v1'): Promise<string> {
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
  userIds.push(owner.id)
})

afterAll(async () => {
  if (msgIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.message_edits WHERE message_id = ANY($1)`, [msgIds])
    await ctx.pool.query(`DELETE FROM aaelink.messages WHERE id = ANY($1)`, [msgIds])
  }
  if (chIds.length) await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = ANY($1)`, [chIds])
  if (wsIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE workspace_id = ANY($1)`, [wsIds])
    await ctx.pool.query(`DELETE FROM aaelink.workspaces WHERE id = ANY($1)`, [wsIds])
  }
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('message edit history', () => {
  it('records prior bodies and lists them newest-first', async () => {
    const ws = await mkWorkspace()
    const ch = await mkChannel(ws)
    const msg = await mkMessage(ch, owner.id, 'current')

    expect(await messageEditCount(ctx.pool, msg)).toBe(0)
    expect(await listMessageEdits(ctx.pool, msg)).toEqual([])

    await recordMessageEdit(ctx.pool, { messageId: msg, channelId: ch, editorId: owner.id, previousBody: 'v1', editedAt: 1000 })
    await recordMessageEdit(ctx.pool, { messageId: msg, channelId: ch, editorId: owner.id, previousBody: 'v2', editedAt: 2000 })

    expect(await messageEditCount(ctx.pool, msg)).toBe(2)
    const edits = await listMessageEdits(ctx.pool, msg)
    expect(edits.map(e => e.previous_body)).toEqual(['v2', 'v1']) // newest edit first
    expect(edits[0].editor_id).toBe(owner.id)
    expect(edits[0].edited_at).toBe(2000)
  })

  it('isolates history per message', async () => {
    const ws = await mkWorkspace()
    const ch = await mkChannel(ws)
    const a = await mkMessage(ch, owner.id)
    const b = await mkMessage(ch, owner.id)
    await recordMessageEdit(ctx.pool, { messageId: a, channelId: ch, editorId: owner.id, previousBody: 'old-a', editedAt: 1000 })

    expect(await messageEditCount(ctx.pool, a)).toBe(1)
    expect(await messageEditCount(ctx.pool, b)).toBe(0)
  })
})
