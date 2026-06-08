/**
 * Integration test: outgoing-webhook + Events-API fan-out for entity events
 * (Integrations parity gaps 5 + 23).
 *
 * emitWebhookEvent was wired only on message/reaction/interaction paths. This
 * pins the newly-wired entity write paths:
 *   - channel.created            -> POST /api/channels
 *   - file.uploaded              -> POST /api/files/upload
 *   - user.deactivated           -> POST /api/admin/users/deactivate
 *   - compliance.dlp_violation   -> recordDlpViolation (driven via POST /api/messages)
 *
 * For each, BOTH delivery lanes must fire: a `webhook_deliver` job (+
 * webhook_deliveries_v2 row) for the matching active webhooks_v2 row, and an
 * `event_deliver` job for the matching active+verified event_subscription.
 *
 * These assertions fail if any emit call is removed from its write path.
 * Mirrors __tests__/api/webhook-emit.test.ts + event-subscription-dispatch.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID, createHmac } from 'crypto'
import {
  createTestContext, createTestUser, createTestChannel, asRequest,
  expectSuccess, cleanupTestData, TestContext, TestUser, TestChannel,
} from '../helpers'

let ctx: TestContext
let admin: TestUser
let actor: TestUser
let channel: TestChannel
let wsId: string
let webhookId: string
let subId: string
const createdIds: string[] = []
const extraCleanupUserIds: string[] = []
const dlpRuleIds: string[] = []

const ALL_EVENTS = [
  'channel.created', 'file.uploaded', 'user.deactivated', 'compliance.dlp_violation',
  'user.created', 'call.started', 'call.ended', 'channel.archived',
]

/** Count webhook_deliver jobs (any actor) whose envelope matches event + a data field. */
async function webhookJobs(eventType: string): Promise<Array<Record<string, unknown>>> {
  const { rows } = await ctx.pool.query<{ payload: string }>(
    `SELECT payload FROM aaelink.jobs WHERE type = 'webhook_deliver'`
  )
  return rows
    .map(r => { try { return JSON.parse(r.payload) as { event_type?: string; payload?: string; webhook_id?: string } } catch { return null } })
    .filter((p): p is { event_type?: string; payload: string; webhook_id?: string } =>
      !!p && p.event_type === eventType && p.webhook_id === webhookId)
    .map(p => JSON.parse(p.payload) as Record<string, unknown>)
}

/** Count event_deliver jobs targeting our subscription for an event type. */
async function eventSubJobs(eventType: string): Promise<Array<Record<string, unknown>>> {
  const { rows } = await ctx.pool.query<{ payload: string }>(
    `SELECT payload FROM aaelink.jobs WHERE type = 'event_deliver'`
  )
  return rows
    .map(r => { try { return JSON.parse(r.payload) as { event_type?: string; payload?: string; subscription_id?: string } } catch { return null } })
    .filter((p): p is { event_type?: string; payload: string; subscription_id?: string } =>
      !!p && p.event_type === eventType && p.subscription_id === subId)
    .map(p => JSON.parse(p.payload) as Record<string, unknown>)
}

beforeAll(async () => {
  ctx = await createTestContext()
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  actor = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(admin.id, actor.id)
  const { rows: [m] } = await ctx.pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.workspace_members WHERE user_id = $1 LIMIT 1`, [actor.id]
  )
  wsId = m.workspace_id
  channel = await createTestChannel(ctx.pool, actor.id, { workspaceId: wsId })

  // GLOBAL (null-workspace) outgoing webhook subscribed to every entity event so
  // a single fixture covers all four paths regardless of resolved workspace.
  webhookId = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.webhooks_v2 (id, name, url, secret, events, channel_id, is_active, created_by, created_at)
     VALUES ($1, 'entity-wh', 'https://example.test/hook', 'shh', $2, '', true, $3, $4)`,
    [webhookId, JSON.stringify(ALL_EVENTS), actor.id, Date.now()]
  )

  // GLOBAL active+verified Events-API subscription matching the same events.
  subId = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.event_subscriptions
       (id, bot_id, endpoint_url, events, signing_secret, status, verified,
        verification_token, verified_at, workspace_id, description,
        delivery_count, failure_count, created_by, created_at)
     VALUES ($1, NULL, $2, $3, $4, 'active', true, NULL, 0, NULL, '', 0, 0, $5, $6)`,
    [subId, `https://hook.test/${subId.slice(0, 8)}`, JSON.stringify(ALL_EVENTS),
     `whsec_${randomUUID().replace(/-/g, '')}`, actor.id, Date.now()]
  )
})

// call_rooms and file_attachments created by new tests tracked here for cleanup.
const createdRoomIds: string[] = []
const createdFileIds: string[] = []
// Users registered via /api/auth/register (not in createdIds which only covers
// users inserted via createTestUser; register inserts its own user row).
const registeredUserIds: string[] = []

afterAll(async () => {
  // Clean call rooms and participants created by the call tests.
  if (createdRoomIds.length) {
    const ph = createdRoomIds.map((_, i) => `$${i + 1}`).join(',')
    await ctx.pool.query(`DELETE FROM aaelink.call_participants WHERE room_id IN (${ph})`, createdRoomIds).catch(() => {})
    await ctx.pool.query(`DELETE FROM aaelink.call_rooms WHERE id IN (${ph})`, createdRoomIds).catch(() => {})
  }
  // Clean file rows from resumable-upload test.
  if (createdFileIds.length) {
    const ph = createdFileIds.map((_, i) => `$${i + 1}`).join(',')
    await ctx.pool.query(`DELETE FROM aaelink.file_attachments WHERE id IN (${ph})`, createdFileIds).catch(() => {})
    await ctx.pool.query(`DELETE FROM aaelink.file_scans WHERE file_id IN (${ph})`, createdFileIds).catch(() => {})
    await ctx.pool.query(`DELETE FROM aaelink.file_index WHERE file_id IN (${ph})`, createdFileIds).catch(() => {})
  }
  // Clean self-registered users.
  if (registeredUserIds.length) {
    const ph = registeredUserIds.map((_, i) => `$${i + 1}`).join(',')
    await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id IN (${ph})`, registeredUserIds).catch(() => {})
    await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE user_id IN (${ph})`, registeredUserIds).catch(() => {})
    await ctx.pool.query(`DELETE FROM aaelink.users WHERE id IN (${ph})`, registeredUserIds).catch(() => {})
  }
  await ctx.pool.query(`DELETE FROM aaelink.jobs WHERE created_by = ANY($1)`, [createdIds])
  await ctx.pool.query(`DELETE FROM aaelink.webhook_deliveries_v2 WHERE webhook_id = $1`, [webhookId])
  await ctx.pool.query(`DELETE FROM aaelink.webhooks_v2 WHERE id = $1`, [webhookId])
  await ctx.pool.query(`DELETE FROM aaelink.event_subscriptions WHERE id = $1`, [subId])
  await ctx.pool.query(`DELETE FROM aaelink.event_deliveries WHERE subscription_id = $1`, [subId]).catch(() => {})
  if (dlpRuleIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.dlp_violations WHERE rule_id = ANY($1)`, [dlpRuleIds]).catch(() => {})
    await ctx.pool.query(`DELETE FROM aaelink.dlp_rules WHERE id = ANY($1)`, [dlpRuleIds]).catch(() => {})
  }
  await cleanupTestData(ctx.pool, [...createdIds, ...extraCleanupUserIds])
  await ctx.cleanup()
})

describe('channel.created fan-out (POST /api/channels)', () => {
  it('enqueues a webhook_deliver job + a delivery row + an event_deliver job', async () => {
    const { POST } = await import('@/app/api/channels/route')
    const created = await expectSuccess<{ channel: { id: string } }>(
      await POST(asRequest('POST', '/api/channels', {
        cookie: actor.sessionCookie,
        body: { workspace_id: wsId, display_name: `wh ${randomUUID().slice(0, 6)}`, type: 'O' },
      }))
    )
    const chId = created.channel.id

    const whJobs = await webhookJobs('channel.created')
    expect(whJobs.some(env => (env.data as { channel_id?: string })?.channel_id === chId)).toBe(true)

    const { rows: delivRows } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.webhook_deliveries_v2 WHERE webhook_id = $1 AND event_type = 'channel.created'`,
      [webhookId]
    )
    expect(delivRows.length).toBeGreaterThan(0)

    const subJobs = await eventSubJobs('channel.created')
    expect(subJobs.some(env => (env.data as { channel_id?: string })?.channel_id === chId)).toBe(true)

    // Cleanup the created channel (cascades off workspace otherwise survive).
    await ctx.pool.query(`DELETE FROM aaelink.channel_members WHERE channel_id = $1`, [chId])
    await ctx.pool.query(`DELETE FROM aaelink.messages WHERE channel_id = $1`, [chId])
    await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = $1`, [chId])
  })
})

describe('file.uploaded fan-out (POST /api/files/upload)', () => {
  it('enqueues both lanes carrying the uploaded file id', async () => {
    const fd = new FormData()
    fd.set('file', new Blob([Buffer.from('hook-bytes')], { type: 'text/plain' }), 'hook.txt')
    fd.set('channel_id', channel.id)
    const token = (() => {
      const secret = process.env.CSRF_SECRET || 'test-csrf-secret'
      const raw = randomUUID().replace(/-/g, '')
      const sig = createHmac('sha256', secret).update(raw).digest('hex').slice(0, 16)
      return `${raw}.${sig}`
    })()
    const cookie = `${actor.sessionCookie}; AAELINK_CSRF=${token}`
    ;(globalThis as { __TEST_COOKIE_HEADER__?: string }).__TEST_COOKIE_HEADER__ = cookie
    const headers = new Headers()
    headers.set('cookie', cookie)
    headers.set('x-csrf-token', token)
    const { POST } = await import('@/app/api/files/upload/route')
    type Req = Parameters<typeof POST>[0]
    const req = new Request('http://localhost:3040/api/files/upload', {
      method: 'POST', headers, body: fd,
    }) as unknown as Req
    const body = await expectSuccess<{ attachment: { id: string } }>(await POST(req))
    const fileId = body.attachment.id

    const whJobs = await webhookJobs('file.uploaded')
    expect(whJobs.some(env => (env.data as { file_id?: string })?.file_id === fileId)).toBe(true)
    const subJobs = await eventSubJobs('file.uploaded')
    expect(subJobs.some(env => (env.data as { file_id?: string })?.file_id === fileId)).toBe(true)

    await ctx.pool.query(`DELETE FROM aaelink.jobs WHERE payload LIKE $1`, [`%${fileId}%`])
    await ctx.pool.query(`DELETE FROM aaelink.file_scans WHERE file_id = $1`, [fileId]).catch(() => {})
    await ctx.pool.query(`DELETE FROM aaelink.file_index WHERE file_id = $1`, [fileId]).catch(() => {})
    await ctx.pool.query(`DELETE FROM aaelink.file_attachments WHERE id = $1`, [fileId])
  })
})

describe('user.deactivated fan-out (POST /api/admin/users/deactivate)', () => {
  it('enqueues both lanes carrying the deactivated user id', async () => {
    const target = await createTestUser(ctx.pool, { role: 'employee' })
    extraCleanupUserIds.push(target.id)

    const { POST } = await import('@/app/api/admin/users/deactivate/route')
    await expectSuccess(await POST(asRequest('POST', '/api/admin/users/deactivate', {
      cookie: admin.sessionCookie, body: { user_id: target.id, active: false },
    })))

    const whJobs = await webhookJobs('user.deactivated')
    expect(whJobs.some(env => (env.data as { user_id?: string })?.user_id === target.id)).toBe(true)
    const subJobs = await eventSubJobs('user.deactivated')
    expect(subJobs.some(env => (env.data as { user_id?: string })?.user_id === target.id)).toBe(true)
  })

  it('does NOT emit on reactivation (active=true)', async () => {
    const target = await createTestUser(ctx.pool, { role: 'employee' })
    extraCleanupUserIds.push(target.id)
    const { POST } = await import('@/app/api/admin/users/deactivate/route')
    await expectSuccess(await POST(asRequest('POST', '/api/admin/users/deactivate', {
      cookie: admin.sessionCookie, body: { user_id: target.id, active: true },
    })))
    const whJobs = await webhookJobs('user.deactivated')
    expect(whJobs.some(env => (env.data as { user_id?: string })?.user_id === target.id)).toBe(false)
  })
})

describe('compliance.dlp_violation fan-out (recordDlpViolation via POST /api/messages)', () => {
  it('enqueues both lanes when a warn-action DLP rule matches a posted message', async () => {
    const ruleId = randomUUID()
    dlpRuleIds.push(ruleId)
    // 'warn' lets the message persist while still recording the violation, so the
    // POST succeeds AND the emit fires. Unique token avoids matching other tests.
    const marker = `dlpmark${randomUUID().slice(0, 8)}`
    await ctx.pool.query(`
      INSERT INTO aaelink.dlp_rules
        (id, name, description, type, pattern, action, severity, priority,
         scope_channels, is_active, created_by, created_at)
      VALUES ($1, $2, '', 'keyword', $3, 'warn', 'high', 9, '[]', true, $4, $5)
    `, [ruleId, `wh-dlp-${marker}`, marker, admin.id, Date.now()])

    const { POST } = await import('@/app/api/messages/route')
    await expectSuccess(await POST(asRequest('POST', '/api/messages', {
      cookie: actor.sessionCookie,
      body: { channel_id: channel.id, message: `secret ${marker} value` },
    })))

    const whJobs = await webhookJobs('compliance.dlp_violation')
    expect(whJobs.some(env => (env.data as { rule_id?: string })?.rule_id === ruleId)).toBe(true)
    const subJobs = await eventSubJobs('compliance.dlp_violation')
    expect(subJobs.some(env => (env.data as { rule_id?: string })?.rule_id === ruleId)).toBe(true)

    // Snippet/content must NOT leak into the event payload (metadata only).
    const leaking = whJobs.find(env => (env.data as { rule_id?: string })?.rule_id === ruleId)
    expect(JSON.stringify(leaking?.data ?? {})).not.toContain(marker)
  })
})

// ── NEW: user.created ────────────────────────────────────────────────────────

describe('user.created fan-out (POST /api/admin/users)', () => {
  it('enqueues webhook_deliver + webhook_deliveries_v2 + event_deliver for user.created', async () => {
    // Drive the admin-create path (POST /api/admin/users) to trigger emitUserCreated.
    const suffix = randomUUID().slice(0, 8)
    const { POST: adminPost } = await import('@/app/api/admin/users/route')
    const res = await expectSuccess<{ user: { id: string } }>(
      await adminPost(asRequest('POST', '/api/admin/users', {
        cookie: admin.sessionCookie,
        body: {
          username: `created_${suffix}`,
          email: `created_${suffix}@aaelink.test`,
          password: 'Test1234!',
          first_name: 'Created',
          last_name: 'Test',
        },
      }))
    )
    const newUserId = res.user.id
    // Track for cleanup — this user was created via the route (not createTestUser),
    // so it has no session; just delete the user row directly in afterAll.
    registeredUserIds.push(newUserId)

    const whJobs = await webhookJobs('user.created')
    expect(whJobs.some(env => (env.data as { user_id?: string })?.user_id === newUserId)).toBe(true)

    const { rows: delivRows } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.webhook_deliveries_v2 WHERE webhook_id = $1 AND event_type = 'user.created'`,
      [webhookId]
    )
    expect(delivRows.length).toBeGreaterThan(0)

    const subJobs = await eventSubJobs('user.created')
    expect(subJobs.some(env => (env.data as { user_id?: string })?.user_id === newUserId)).toBe(true)
  })
})

// ── NEW: call.started + call.ended ──────────────────────────────────────────

describe('call.started / call.ended fan-out (POST + PUT /api/calls/rooms)', () => {
  it('enqueues both lanes for call.started after room creation', async () => {
    const { POST: callPost } = await import('@/app/api/calls/rooms/route')
    const res = await expectSuccess<{ room: { id: string } }>(
      await callPost(asRequest('POST', '/api/calls/rooms', {
        cookie: actor.sessionCookie,
        body: { call_type: 'voice', title: 'test-call' },
      }))
    )
    const roomId = res.room.id
    createdRoomIds.push(roomId)

    const whJobs = await webhookJobs('call.started')
    expect(whJobs.some(env => (env.data as { room_id?: string })?.room_id === roomId)).toBe(true)

    const { rows: delivRows } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.webhook_deliveries_v2 WHERE webhook_id = $1 AND event_type = 'call.started'`,
      [webhookId]
    )
    expect(delivRows.length).toBeGreaterThan(0)

    const subJobs = await eventSubJobs('call.started')
    expect(subJobs.some(env => (env.data as { room_id?: string })?.room_id === roomId)).toBe(true)
  })

  it('enqueues both lanes for call.ended after the end action', async () => {
    // Create a fresh room then end it.
    const { POST: callPost, PUT: callPut } = await import('@/app/api/calls/rooms/route')
    const createRes = await expectSuccess<{ room: { id: string } }>(
      await callPost(asRequest('POST', '/api/calls/rooms', {
        cookie: actor.sessionCookie,
        body: { call_type: 'voice', title: 'test-call-end' },
      }))
    )
    const roomId = createRes.room.id
    createdRoomIds.push(roomId)

    await expectSuccess(
      await callPut(asRequest('PUT', '/api/calls/rooms', {
        cookie: actor.sessionCookie,
        body: { action: 'end', room_id: roomId },
      }))
    )

    const whJobs = await webhookJobs('call.ended')
    expect(whJobs.some(env => (env.data as { room_id?: string })?.room_id === roomId)).toBe(true)

    const { rows: delivRows } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.webhook_deliveries_v2 WHERE webhook_id = $1 AND event_type = 'call.ended'`,
      [webhookId]
    )
    expect(delivRows.length).toBeGreaterThan(0)

    const subJobs = await eventSubJobs('call.ended')
    expect(subJobs.some(env => (env.data as { room_id?: string })?.room_id === roomId)).toBe(true)
  })
})

// ── NEW: file.uploaded via resumable path ───────────────────────────────────

describe('file.uploaded fan-out (resumable upload via upload-sessions)', () => {
  it('enqueues both lanes when completeUploadSession inserts the file row', async () => {
    // The local backend (no S3 in tests) uses PART_SIZE = 8 MB parts, but
    // appendPart requires that every interior part == part_size and the FINAL
    // part == declaredSize - part_size*(totalParts-1). For a single-part file
    // the only part IS the final part, so its size == declaredSize. Use a tiny
    // 10-byte file so total_parts = 1 and bytes == 10.
    const fileBytes = Buffer.from('helloworld') // 10 bytes
    const declaredSize = fileBytes.length

    const { POST: sessionPost } = await import('@/app/api/files/upload-sessions/route')
    const sessionRes = await expectSuccess<{ session: { id: string; part_size: number } }>(
      await sessionPost(asRequest('POST', '/api/files/upload-sessions', {
        cookie: actor.sessionCookie,
        body: { filename: 'resume-test.txt', content_type: 'text/plain', size: declaredSize, channel_id: channel.id },
      }))
    )
    const sessionId = sessionRes.session.id

    // PUT the single part — raw bytes body, not JSON.
    const { PUT: sessionPut, POST: sessionIdPost } = await import('@/app/api/files/upload-sessions/[id]/route')
    const csrfSecret = process.env.CSRF_SECRET || 'test-csrf-secret'
    const csrfRaw = randomUUID().replace(/-/g, '')
    const csrfSig = createHmac('sha256', csrfSecret).update(csrfRaw).digest('hex').slice(0, 16)
    const csrfToken = `${csrfRaw}.${csrfSig}`
    const cookie = `${actor.sessionCookie}; AAELINK_CSRF=${csrfToken}`
    ;(globalThis as { __TEST_COOKIE_HEADER__?: string }).__TEST_COOKIE_HEADER__ = cookie

    const putHeaders = new Headers()
    putHeaders.set('cookie', cookie)
    putHeaders.set('x-csrf-token', csrfToken)
    putHeaders.set('content-type', 'application/octet-stream')
    const putReq = new Request(
      `http://localhost:3040/api/files/upload-sessions/${sessionId}?part=1`,
      { method: 'PUT', headers: putHeaders, body: fileBytes }
    ) as Parameters<typeof sessionPut>[0]
    await expectSuccess(await sessionPut(putReq, { params: Promise.resolve({ id: sessionId }) }))

    // POST complete
    const completeRes = await expectSuccess<{ attachment: { id: string } }>(
      await sessionIdPost(
        asRequest('POST', `/api/files/upload-sessions/${sessionId}`, {
          cookie, headers: { 'x-csrf-token': csrfToken }, body: { action: 'complete' },
        }) as Parameters<typeof sessionIdPost>[0],
        { params: Promise.resolve({ id: sessionId }) }
      )
    )
    const fileId = completeRes.attachment.id
    createdFileIds.push(fileId)

    const whJobs = await webhookJobs('file.uploaded')
    expect(whJobs.some(env => (env.data as { file_id?: string })?.file_id === fileId)).toBe(true)

    const { rows: delivRows } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.webhook_deliveries_v2 WHERE webhook_id = $1 AND event_type = 'file.uploaded'`,
      [webhookId]
    )
    expect(delivRows.length).toBeGreaterThan(0)

    const subJobs = await eventSubJobs('file.uploaded')
    expect(subJobs.some(env => (env.data as { file_id?: string })?.file_id === fileId)).toBe(true)
  })
})

// ── NEW: channel.archived via hard DELETE ────────────────────────────────────

describe('channel.archived fan-out (DELETE /api/channels)', () => {
  it('enqueues both lanes for channel.archived after a hard delete', async () => {
    // Create a non-default channel that the admin (owner) can delete.
    const suffix = randomUUID().slice(0, 6)
    const ch = await createTestChannel(ctx.pool, admin.id, {
      workspaceId: wsId, name: `del-ch-${suffix}`,
    })
    // Ensure admin is workspace owner (needed for DELETE permission check).
    await ctx.pool.query(
      `UPDATE aaelink.workspace_members SET role = 'owner' WHERE workspace_id = $1 AND user_id = $2`,
      [wsId, admin.id]
    )

    const { DELETE: channelDelete } = await import('@/app/api/channels/route')
    await expectSuccess(
      await channelDelete(asRequest('DELETE', '/api/channels', {
        cookie: admin.sessionCookie,
        body: { channel_id: ch.id },
      }))
    )

    const whJobs = await webhookJobs('channel.archived')
    expect(whJobs.some(env => (env.data as { channel_id?: string })?.channel_id === ch.id)).toBe(true)

    const { rows: delivRows } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.webhook_deliveries_v2 WHERE webhook_id = $1 AND event_type = 'channel.archived'`,
      [webhookId]
    )
    expect(delivRows.length).toBeGreaterThan(0)

    const subJobs = await eventSubJobs('channel.archived')
    expect(subJobs.some(env => (env.data as { channel_id?: string })?.channel_id === ch.id)).toBe(true)
  })
})
