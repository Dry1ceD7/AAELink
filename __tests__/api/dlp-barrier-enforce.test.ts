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

describe('information-barrier block_search enforcement', () => {
  it('hides barred users from /api/search/users both directions', async () => {
    // barrier: alice (group_a) ↔ bob (group_b), block_search=true
    const searchBarrierId = randomUUID()
    await ctx.pool.query(
      `INSERT INTO aaelink.information_barriers
         (id, name, type, description, group_a_ids, group_b_ids, block_dm, block_channels, block_search, block_file_share, is_active, created_by, created_at)
       VALUES ($1, $2, 'custom', '', $3, $4, false, false, true, false, true, $5, $6)`,
      [searchBarrierId, `sb-${searchBarrierId.slice(0, 8)}`, JSON.stringify([alice.id]), JSON.stringify([bob.id]), alice.id, Date.now()]
    )
    barrierIds.push(searchBarrierId)

    const { GET } = await import('@/app/api/search/users/route')

    // alice searches for bob — should not appear
    const resAlice = await GET(asRequest('GET', `/api/search/users?q=${bob.id.slice(0, 8)}&workspace_id=${wsId}`, { cookie: alice.sessionCookie }))
    const bodyAlice = await expectSuccess<{ users: { id: string }[] }>(resAlice)
    expect(bodyAlice.users.map((u) => u.id)).not.toContain(bob.id)

    // bob searches for alice — should not appear
    const resBob = await GET(asRequest('GET', `/api/search/users?q=${alice.id.slice(0, 8)}&workspace_id=${wsId}`, { cookie: bob.sessionCookie }))
    const bodyBob = await expectSuccess<{ users: { id: string }[] }>(resBob)
    expect(bodyBob.users.map((u) => u.id)).not.toContain(alice.id)
  })

  it('hides barred users from /api/users/directory both directions', async () => {
    const { GET } = await import('@/app/api/users/directory/route')

    // alice lists directory — bob should not appear
    const resAlice = await GET(asRequest('GET', `/api/users/directory?search=${bob.id.slice(0, 8)}`, { cookie: alice.sessionCookie }))
    const bodyAlice = await expectSuccess<{ members: { id: string }[] }>(resAlice)
    expect(bodyAlice.members.map((m) => m.id)).not.toContain(bob.id)

    // bob lists directory — alice should not appear
    const resBob = await GET(asRequest('GET', `/api/users/directory?search=${alice.id.slice(0, 8)}`, { cookie: bob.sessionCookie }))
    const bodyBob = await expectSuccess<{ members: { id: string }[] }>(resBob)
    expect(bodyBob.members.map((m) => m.id)).not.toContain(alice.id)
  })

  it('does NOT hide non-barred users from search results', async () => {
    const dave = await createTestUser(ctx.pool, { role: 'employee' })
    createdIds.push(dave.id)
    const { GET } = await import('@/app/api/search/users/route')

    // alice is not barriered from dave — should appear
    const res = await GET(asRequest('GET', `/api/search/users?q=${dave.id.slice(0, 8)}&workspace_id=${wsId}`, { cookie: alice.sessionCookie }))
    const body = await expectSuccess<{ users: { id: string }[] }>(res)
    expect(body.users.map((u) => u.id)).toContain(dave.id)
  })
})

describe('information-barrier block_file_share enforcement', () => {
  it('blocks attaching a file to a message in a channel shared with a barriered member (403)', async () => {
    // barrier: alice (group_a) ↔ bob (group_b), block_file_share=true
    const fsBarrierId = randomUUID()
    await ctx.pool.query(
      `INSERT INTO aaelink.information_barriers
         (id, name, type, description, group_a_ids, group_b_ids, block_dm, block_channels, block_search, block_file_share, is_active, created_by, created_at)
       VALUES ($1, $2, 'custom', '', $3, $4, false, false, false, true, true, $5, $6)`,
      [fsBarrierId, `fs-${fsBarrierId.slice(0, 8)}`, JSON.stringify([alice.id]), JSON.stringify([bob.id]), alice.id, Date.now()]
    )
    barrierIds.push(fsBarrierId)

    // Create a channel with both alice and bob as members
    const channel = await createTestChannel(ctx.pool, alice.id, { workspaceId: wsId })
    await ctx.pool.query(
      `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
       VALUES ($1, $2, 'member', $3) ON CONFLICT DO NOTHING`,
      [channel.id, bob.id, Date.now()]
    )

    // Insert a test message from alice
    const msgId = randomUUID()
    await ctx.pool.query(
      `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, '', $5, $5)`,
      [msgId, channel.id, alice.id, 'file share test', Date.now()]
    )

    // Upload a fake file record
    const fileId = randomUUID()
    await ctx.pool.query(
      `INSERT INTO aaelink.file_attachments (id, filename, content_type, size, storage_key, user_id, channel_id, workspace_id, deleted_at, created_at)
       VALUES ($1, 'test.txt', 'text/plain', 10, $2, $3, $4, $5, 0, $6)`,
      [fileId, `test-${fileId}`, alice.id, channel.id, wsId, Date.now()]
    )

    const { POST } = await import('@/app/api/messages/attachments/route')
    const res = await POST(asRequest('POST', '/api/messages/attachments', {
      cookie: alice.sessionCookie,
      body: { message_id: msgId, file_ids: [fileId] },
    }))
    await expectError(res, 403, 'blocked_by_information_barrier')

    // cleanup
    await ctx.pool.query(`DELETE FROM aaelink.file_attachments WHERE id = $1`, [fileId])
    await ctx.pool.query(`DELETE FROM aaelink.messages WHERE id = $1`, [msgId])
    await ctx.pool.query(`DELETE FROM aaelink.channel_members WHERE channel_id = $1`, [channel.id])
  })

  it('allows attaching a file when no barrier applies (200)', async () => {
    const eve = await createTestUser(ctx.pool, { role: 'employee' })
    createdIds.push(eve.id)

    // Channel with only alice and eve (not barriered)
    const channel = await createTestChannel(ctx.pool, alice.id, { workspaceId: wsId })
    await ctx.pool.query(
      `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
       VALUES ($1, $2, 'member', $3) ON CONFLICT DO NOTHING`,
      [channel.id, eve.id, Date.now()]
    )

    const msgId = randomUUID()
    await ctx.pool.query(
      `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, '', $5, $5)`,
      [msgId, channel.id, alice.id, 'safe file share', Date.now()]
    )

    const fileId = randomUUID()
    await ctx.pool.query(
      `INSERT INTO aaelink.file_attachments (id, filename, content_type, size, storage_key, user_id, channel_id, workspace_id, deleted_at, created_at)
       VALUES ($1, 'safe.txt', 'text/plain', 5, $2, $3, $4, $5, 0, $6)`,
      [fileId, `safe-${fileId}`, alice.id, channel.id, wsId, Date.now()]
    )

    const { POST } = await import('@/app/api/messages/attachments/route')
    const res = await POST(asRequest('POST', '/api/messages/attachments', {
      cookie: alice.sessionCookie,
      body: { message_id: msgId, file_ids: [fileId] },
    }))
    await expectSuccess(res)

    // cleanup
    await ctx.pool.query(`DELETE FROM aaelink.message_attachments WHERE message_id = $1`, [msgId])
    await ctx.pool.query(`DELETE FROM aaelink.file_attachments WHERE id = $1`, [fileId])
    await ctx.pool.query(`DELETE FROM aaelink.messages WHERE id = $1`, [msgId])
    await ctx.pool.query(`DELETE FROM aaelink.channel_members WHERE channel_id = $1`, [channel.id])
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

describe('information-barrier enforcement on POST /api/channels', () => {
  it('blocks a 1:1 DM created via POST /api/channels when a barrier separates the pair (403)', async () => {
    // barrier between alice and bob is already active from addBarrier() in the earlier suite
    const { POST } = await import('@/app/api/channels/route')
    const res = await POST(asRequest('POST', '/api/channels', {
      cookie: alice.sessionCookie,
      body: { workspace_id: wsId, peer_user_id: bob.id },
    }))
    await expectError(res, 403, 'blocked_by_information_barrier')
  })

  it('blocks a group DM created via POST /api/channels when a barrier separates any pair (403)', async () => {
    const carol = await createTestUser(ctx.pool, { role: 'employee' })
    createdIds.push(carol.id)
    // carol is outside both barrier groups but alice and bob are barriered
    const { POST } = await import('@/app/api/channels/route')
    const res = await POST(asRequest('POST', '/api/channels', {
      cookie: carol.sessionCookie,
      body: { workspace_id: wsId, peer_user_ids: [alice.id, bob.id] },
    }))
    await expectError(res, 403, 'blocked_by_information_barrier')
  })

  it('allows a 1:1 DM via POST /api/channels when no barrier applies (200)', async () => {
    const dave = await createTestUser(ctx.pool, { role: 'employee' })
    createdIds.push(dave.id)
    // dave is not in any barrier group
    const { POST } = await import('@/app/api/channels/route')
    const res = await POST(asRequest('POST', '/api/channels', {
      cookie: alice.sessionCookie,
      body: { workspace_id: wsId, peer_user_id: dave.id },
    }))
    await expectSuccess<{ channel: { id: string } }>(res)
  })

  it('allows a group DM via POST /api/channels when no barrier applies (200)', async () => {
    const eve = await createTestUser(ctx.pool, { role: 'employee' })
    const frank = await createTestUser(ctx.pool, { role: 'employee' })
    createdIds.push(eve.id, frank.id)
    // eve and frank are not in any barrier group
    const { POST } = await import('@/app/api/channels/route')
    const res = await POST(asRequest('POST', '/api/channels', {
      cookie: alice.sessionCookie,
      body: { workspace_id: wsId, peer_user_ids: [eve.id, frank.id] },
    }))
    await expectSuccess<{ channel: { id: string } }>(res)
  })
})

describe('forward source-read authz (IDOR guard)', () => {
  async function seedMessage(channelId: string, authorId: string, bodyText: string): Promise<string> {
    const msgId = randomUUID()
    await ctx.pool.query(
      `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, '', $5, $5)`,
      [msgId, channelId, authorId, bodyText, Date.now()]
    )
    return msgId
  }

  it('denies forwarding from a private channel the requester cannot read (404 message_not_found)', async () => {
    // alice owns a PRIVATE source channel; bob is a workspace member but NOT a
    // channel member, so userCanReadChannel(bob, source) is false.
    const src = await createTestChannel(ctx.pool, alice.id, { workspaceId: wsId, type: 'private' })
    const dst = await createTestChannel(ctx.pool, bob.id, { workspaceId: wsId })
    const msgId = await seedMessage(src.id, alice.id, 'private source secret')

    const { POST } = await import('@/app/api/messages/forward/route')
    const res = await POST(asRequest('POST', '/api/messages/forward', {
      cookie: bob.sessionCookie,
      body: { message_id: msgId, target_channel_id: dst.id },
    }))
    // Same shape as a missing message — no existence oracle.
    await expectError(res, 404, 'message_not_found')

    // The forwarded message must NOT have been created in the target channel.
    const { rows } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.messages WHERE channel_id = $1 AND body LIKE '%private source secret%'`,
      [dst.id]
    )
    expect(rows.length).toBe(0)
  })

  it('allows a member to forward from a private channel they can read (200)', async () => {
    // alice owns a PRIVATE source channel and is a member, so she can read it.
    const src = await createTestChannel(ctx.pool, alice.id, { workspaceId: wsId, type: 'private' })
    const dst = await createTestChannel(ctx.pool, alice.id, { workspaceId: wsId })
    const msgId = await seedMessage(src.id, alice.id, 'forwardable private content')

    const { POST } = await import('@/app/api/messages/forward/route')
    const res = await POST(asRequest('POST', '/api/messages/forward', {
      cookie: alice.sessionCookie,
      body: { message_id: msgId, target_channel_id: dst.id },
    }))
    const out = await expectSuccess<{ message_id: string; target_channel_id: string }>(res)
    expect(out.target_channel_id).toBe(dst.id)

    const { rows } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.messages WHERE id = $1 AND channel_id = $2`,
      [out.message_id, dst.id]
    )
    expect(rows.length).toBe(1)
  })
})
