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

describe('DLP enforcement — keyword_block rule type blocks on POST', () => {
  it('blocks a message matching a keyword_block rule (403)', async () => {
    await addDlpRule('keyword_block', 'ZZKWBLOCKZZ', 'block')
    const channel = await createTestChannel(ctx.pool, alice.id, { workspaceId: wsId })
    const res = await postMessage(alice.sessionCookie, channel.id, 'leaking ZZKWBLOCKZZ data')
    await expectError(res, 403, 'dlp_blocked')
  })
})

describe('DLP enforcement on message edit (PATCH)', () => {
  it('blocks editing a message into content matching a block rule (403)', async () => {
    await addDlpRule('keyword_block', 'ZZEDITZZ', 'block')
    const channel = await createTestChannel(ctx.pool, alice.id, { workspaceId: wsId })
    // Create a clean message first
    const createRes = await postMessage(alice.sessionCookie, channel.id, 'a clean edit target')
    const created = await expectSuccess<{ id: string }>(createRes)
    const messageId = created.id
    // PATCH it to content that trips the block rule
    const { PATCH } = await import('@/app/api/messages/[id]/route')
    const res = await PATCH(
      asRequest('PATCH', `/api/messages/${messageId}`, {
        cookie: alice.sessionCookie,
        body: { message: 'now contains ZZEDITZZ forbidden' },
      }),
      { params: Promise.resolve({ id: messageId }) }
    )
    await expectError(res, 403, 'dlp_blocked')
  })
})

describe('DLP enforcement on message forward', () => {
  it('blocks forwarding content matching a block rule (403)', async () => {
    await addDlpRule('keyword_block', 'ZZFWDZZ', 'block')
    const srcChannel = await createTestChannel(ctx.pool, alice.id, { workspaceId: wsId })
    const dstChannel = await createTestChannel(ctx.pool, alice.id, { workspaceId: wsId })
    // Insert the offending message directly to avoid the POST DLP gate blocking before forward
    const msgId = randomUUID()
    await ctx.pool.query(
      `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, '', $5, $5)`,
      [msgId, srcChannel.id, alice.id, 'contains ZZFWDZZ secret', Date.now()]
    )
    const { POST } = await import('@/app/api/messages/forward/route')
    const res = await POST(
      asRequest('POST', '/api/messages/forward', {
        cookie: alice.sessionCookie,
        body: { message_id: msgId, target_channel_id: dstChannel.id },
      })
    )
    await expectError(res, 403, 'dlp_blocked')
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

  it('blocks conversations/open between alice and bob (barrier check on open)', async () => {
    // Barrier created in addBarrier() separates alice (group_a) from bob (group_b).
    const { POST } = await import('@/app/api/conversations/open/route')
    const res = await POST(asRequest('POST', '/api/conversations/open', {
      cookie: alice.sessionCookie,
      body: { action: 'open', users: [alice.id, bob.id] },
    }))
    await expectError(res, 403, 'blocked_by_information_barrier')
  })

  it('blocks a group DM created by an unrelated third user when alice and bob are recipients (pairwise check)', async () => {
    // carol is not in either barrier group but is creating a group DM with alice + bob.
    const carol = await createTestUser(ctx.pool, { role: 'employee' })
    createdIds.push(carol.id)
    const { POST } = await import('@/app/api/channels/dm/route')
    const res = await POST(asRequest('POST', '/api/channels/dm', {
      cookie: carol.sessionCookie,
      body: { user_ids: [alice.id, bob.id], workspace_id: wsId },
    }))
    await expectError(res, 403, 'blocked_by_information_barrier')
  })
})

describe('information-barrier type enforcement', () => {
  it('rejects creating a department-type barrier (400 barrier_type_not_supported)', async () => {
    const admin = await createTestUser(ctx.pool, { role: 'super_admin' })
    createdIds.push(admin.id)
    const { POST } = await import('@/app/api/compliance/barriers/route')
    const res = await POST(asRequest('POST', '/api/compliance/barriers', {
      cookie: admin.sessionCookie,
      body: {
        name: 'dept-barrier-test',
        type: 'department',
        group_a_ids: [alice.id],
        group_b_ids: [bob.id],
      },
    }))
    await expectError(res, 400, 'barrier_type_not_supported')
  })
})
