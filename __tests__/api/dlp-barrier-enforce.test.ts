/**
 * Integration test: DLP + information-barrier ENFORCEMENT on the send / DM /
 * join paths. The engines existed but nothing called them (audit P0); they must
 * now block (DLP block, barrier DM/channel) and redact (DLP redact) inline.
 *
 * Rules/barriers are global, so each is created with a unique pattern that only
 * matches this file's fixtures and is deleted in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, createTestChannel, asRequest,
  expectSuccess, expectError, cleanupTestData,
  TestContext, TestUser,
} from '../helpers'

let ctx: TestContext
let alice: TestUser
let bob: TestUser
let wsId: string
const createdIds: string[] = []
const ruleIds: string[] = []
const barrierIds: string[] = []

async function addDlpRule(type: string, pattern: string, action: string): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.dlp_rules
       (id, name, description, type, pattern, action, severity, priority, scope_channels, is_active, created_by, created_at)
     VALUES ($1, $2, '', $3, $4, $5, 'high', 9, '[]', true, $6, $7)`,
    [id, `t-${id.slice(0, 8)}`, type, pattern, action, alice.id, Date.now()]
  )
  ruleIds.push(id)
  return id
}

async function addBarrier(): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.information_barriers
       (id, name, type, description, group_a_ids, group_b_ids, block_dm, block_channels, block_search, block_file_share, is_active, created_by, created_at)
     VALUES ($1, $2, 'custom', '', $3, $4, true, true, false, false, true, $5, $6)`,
    [id, `b-${id.slice(0, 8)}`, JSON.stringify([alice.id]), JSON.stringify([bob.id]), alice.id, Date.now()]
  )
  barrierIds.push(id)
  return id
}

async function postMessage(cookie: string, channelId: string, message: string) {
  const { POST } = await import('@/app/api/messages/route')
  return POST(asRequest('POST', '/api/messages', { cookie, body: { channel_id: channelId, message } }))
}

beforeAll(async () => {
  ctx = await createTestContext()
  alice = await createTestUser(ctx.pool, { role: 'employee' })
  bob = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(alice.id, bob.id)
  const { rows: [m] } = await ctx.pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.workspace_members WHERE user_id = $1 LIMIT 1`, [alice.id]
  )
  wsId = m.workspace_id
})

afterAll(async () => {
  if (ruleIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.dlp_violations WHERE rule_id = ANY($1)`, [ruleIds])
    await ctx.pool.query(`DELETE FROM aaelink.dlp_rules WHERE id = ANY($1)`, [ruleIds])
  }
  if (barrierIds.length) await ctx.pool.query(`DELETE FROM aaelink.information_barriers WHERE id = ANY($1)`, [barrierIds])
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('DLP enforcement on message send', () => {
  it('blocks a message matching a block rule (403) and records a violation', async () => {
    const ruleId = await addDlpRule('keyword', 'ZZBLOCKZZ', 'block')
    const channel = await createTestChannel(ctx.pool, alice.id, { workspaceId: wsId })
    const res = await postMessage(alice.sessionCookie, channel.id, 'leaking ZZBLOCKZZ now')
    await expectError(res, 403, 'dlp_blocked')
    const { rows } = await ctx.pool.query(`SELECT 1 FROM aaelink.dlp_violations WHERE rule_id = $1`, [ruleId])
    expect(rows.length).toBeGreaterThan(0)
  })

  it('redacts a message matching a redact rule and persists the masked body', async () => {
    await addDlpRule('keyword', 'ZZREDACTZZ', 'redact')
    const channel = await createTestChannel(ctx.pool, alice.id, { workspaceId: wsId })
    const res = await postMessage(alice.sessionCookie, channel.id, 'my token is ZZREDACTZZ ok')
    const body = await expectSuccess<{ id: string }>(res)
    const { rows } = await ctx.pool.query<{ body: string }>(
      `SELECT body FROM aaelink.messages WHERE id = $1`, [body.id]
    )
    expect(rows[0].body).toContain('[REDACTED]')
    expect(rows[0].body).not.toContain('ZZREDACTZZ')
  })

  it('lets a non-matching message through unchanged', async () => {
    const channel = await createTestChannel(ctx.pool, alice.id, { workspaceId: wsId })
    const res = await postMessage(alice.sessionCookie, channel.id, 'a perfectly normal message')
    await expectSuccess(res)
  })
})

describe('information-barrier enforcement', () => {
  it('blocks creating a DM across a barrier', async () => {
    await addBarrier()
    const { POST } = await import('@/app/api/channels/dm/route')
    const res = await POST(asRequest('POST', '/api/channels/dm', {
      cookie: alice.sessionCookie, body: { user_ids: [bob.id], workspace_id: wsId },
    }))
    await expectError(res, 403, 'blocked_by_information_barrier')
  })

  it('blocks joining a channel that contains a barriered member', async () => {
    // bob owns a public channel; alice is barriered from bob.
    const channel = await createTestChannel(ctx.pool, bob.id, { workspaceId: wsId })
    const { POST } = await import('@/app/api/channels/join/route')
    const res = await POST(asRequest('POST', '/api/channels/join', {
      cookie: alice.sessionCookie, body: { channel_name: channel.name },
    }))
    await expectError(res, 403, 'blocked_by_information_barrier')
  })
})
