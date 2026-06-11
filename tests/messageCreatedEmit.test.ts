/**
 * `app/api/messages` POST emits a `message` PubSubEvent on the channel
 * topic after each successful INSERT — consumed by the WS gateway.
 *
 * Pure-unit test: stubs `lib/db.getPool`, `lib/auth/session.readSessionUserId`,
 * `lib/enterprise/collab-access`, `lib/infra/migrate.ensureSchema`,
 * `lib/auth/csrf.verifyCsrf`, `lib/webhooks/webhookEmitter.emitMessageCreated`,
 * `lib/notifications/notificationsServer`, `lib/enterprise/dlpInterceptor`,
 * `lib/api/oauthScopes`, and the `getPubSub()` factory.
 *
 * Test cases:
 *   1. Normal POST emits a `message` event with correct channel_id + payload shape.
 *   2. Thread-reply POST (root_id set, no broadcast) emits one event with root_id.
 *   3. Broadcast POST (root_id + broadcast=true) emits two events: the thread
 *      reply AND the timeline-visible broadcast copy.
 *   4. Emit failure is swallowed — response is still 200.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => {
  const mockQuery = vi.fn(async () => ({ rows: [] as Record<string, unknown>[] }))
  const mockPool = { query: mockQuery }
  const mockPublish = vi.fn(async () => {})
  const mockEnsureSchema = vi.fn(async () => {})
  const mockUserCanReadChannel = vi.fn(async () => true)
  const mockUserCanPostToChannel = vi.fn(async () => true)
  const mockIsChannelArchived = vi.fn(async () => false)
  const mockReadSessionUserId = vi.fn(async () => 'u-1')
  const mockVerifyCsrf = vi.fn(async () => null)
  const mockEmitMessageCreated = vi.fn(async () => {})
  return {
    mockQuery,
    mockPool,
    mockPublish,
    mockEnsureSchema,
    mockUserCanReadChannel,
    mockUserCanPostToChannel,
    mockIsChannelArchived,
    mockReadSessionUserId,
    mockVerifyCsrf,
    mockEmitMessageCreated,
  }
})

vi.mock('@/lib/infra/db', () => ({ getPool: () => m.mockPool }))
vi.mock('@/lib/infra/migrate', () => ({ ensureSchema: m.mockEnsureSchema }))
vi.mock('@/lib/enterprise/collab-access', () => ({
  userCanReadChannel: m.mockUserCanReadChannel,
  userCanPostToChannel: m.mockUserCanPostToChannel,
  isChannelArchived: m.mockIsChannelArchived,
}))
vi.mock('@/lib/auth/session', () => ({ readSessionUserId: m.mockReadSessionUserId }))
vi.mock('@/lib/auth/csrf', () => ({ verifyCsrf: m.mockVerifyCsrf }))
vi.mock('@/lib/webhooks/webhookEmitter', () => ({ emitMessageCreated: m.mockEmitMessageCreated }))
vi.mock('@/lib/notifications/notificationsServer', () => ({
  notifyChannelMentions: vi.fn(async () => []),
  notifyDirectMessage: vi.fn(async () => {}),
  notifyKeywordMatches: vi.fn(async () => []),
  notifyChannelLevelAll: vi.fn(async () => {}),
  notifyBroadcastMentions: vi.fn(async () => []),
}))
vi.mock('@/lib/enterprise/dlpInterceptor', () => ({
  applyDlpToMessage: vi.fn(async ({ content }: { content: string }) => ({ allowed: true, content })),
}))
vi.mock('@/lib/messaging/mentionParse', () => ({
  parseBroadcastMentions: vi.fn(() => []),
}))
vi.mock('@/lib/api/oauthScopes', () => ({
  enforceScope: vi.fn(async () => ({ kind: 'skip' })),
  SCOPES: { CHAT_WRITE: 'chat:write', CHAT_READ: 'chat:read' },
}))
vi.mock('@/lib/realtime/redisPubSub', async () => {
  const actual = await vi.importActual<typeof import('@/lib/realtime/redisPubSub')>('@/lib/realtime/redisPubSub')
  return {
    ...actual,
    getPubSub: () => ({
      backend: 'memory' as const,
      publish: m.mockPublish,
      subscribe: () => () => {},
      psubscribe: () => () => {},
    }),
  }
})
vi.mock('@/lib/api/tracedRoute', () => ({
  tracedRoute: (_method: string, _path: string, handler: unknown) => handler,
}))

import { POST } from '@/app/api/messages/route'
import { channelTopic } from '@/lib/realtime/redisPubSub'

function postReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/messages', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function callPost(body: Record<string, unknown>): Promise<Response> {
  const fn = POST as unknown as (req: NextRequest) => Promise<Response>
  return fn(postReq(body))
}

describe('POST /api/messages — emits message event on PubSub', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.mockUserCanReadChannel.mockResolvedValue(true)
    m.mockUserCanPostToChannel.mockResolvedValue(true)
    m.mockIsChannelArchived.mockResolvedValue(false)
    m.mockReadSessionUserId.mockResolvedValue('u-1')
    m.mockEnsureSchema.mockResolvedValue(undefined)
    m.mockVerifyCsrf.mockResolvedValue(null)
    m.mockEmitMessageCreated.mockResolvedValue(undefined)
    // Default query: returns empty rows (no channel/user lookups needed for
    // notifications path; the handler guards on ch.workspace_id which will be
    // undefined on empty rows and skips the notify block gracefully).
    m.mockQuery.mockResolvedValue({ rows: [] })
  })

  it('emits one message event with correct channel_id and payload shape', async () => {
    const res = await callPost({ channel_id: 'ch-1', message: 'hello' })
    expect(res.status).toBe(200)

    // Exactly one publish call from the main message emit
    const messageCalls = (m.mockPublish.mock.calls as unknown[][]).filter(
      (call) => (call[1] as { type: string }).type === 'message'
    )
    expect(messageCalls).toHaveLength(1)

    const topic = messageCalls[0][0] as string
    const event = messageCalls[0][1] as { type: string; channel_id: string; payload: Record<string, unknown> }
    expect(topic).toBe(channelTopic('ch-1'))
    expect(event).toMatchObject({
      type: 'message',
      channel_id: 'ch-1',
      payload: expect.objectContaining({
        channel_id: 'ch-1',
        user_id: 'u-1',
        message: 'hello',
      }),
    })
  })

  it('emits message event carrying root_id when posting a thread reply', async () => {
    // Seed the parent-message validation query to return a valid root message.
    ;(m.mockQuery as ReturnType<typeof vi.fn>).mockImplementation(async (sql: unknown) => {
      if (typeof sql === 'string' && sql.includes('FROM aaelink.messages WHERE id')) {
        return { rows: [{ id: 'root-1', channel_id: 'ch-1', root_id: '' }] as Record<string, unknown>[] }
      }
      return { rows: [] as Record<string, unknown>[] }
    })

    const res = await callPost({ channel_id: 'ch-1', message: 'reply', root_id: 'root-1' })
    expect(res.status).toBe(200)

    const messageCalls = (m.mockPublish.mock.calls as unknown[][]).filter(
      (call) => (call[1] as { type: string }).type === 'message'
    )
    expect(messageCalls).toHaveLength(1)

    const event = messageCalls[0][1] as { type: string; channel_id: string; payload: Record<string, unknown> }
    expect(event).toMatchObject({
      type: 'message',
      channel_id: 'ch-1',
      payload: expect.objectContaining({
        root_id: 'root-1',
        user_id: 'u-1',
      }),
    })
  })

  it('emits two message events when broadcast=true (thread reply + timeline copy)', async () => {
    // Seed parent-message validation.
    ;(m.mockQuery as ReturnType<typeof vi.fn>).mockImplementation(async (sql: unknown) => {
      if (typeof sql === 'string' && sql.includes('FROM aaelink.messages WHERE id')) {
        return { rows: [{ id: 'root-1', channel_id: 'ch-1', root_id: '' }] as Record<string, unknown>[] }
      }
      return { rows: [] as Record<string, unknown>[] }
    })

    const res = await callPost({
      channel_id: 'ch-1',
      message: 'broadcast reply',
      root_id: 'root-1',
      broadcast: true,
    })
    expect(res.status).toBe(200)

    const messageCalls = (m.mockPublish.mock.calls as unknown[][]).filter(
      (call) => (call[1] as { type: string }).type === 'message'
    )
    // Broadcast path: broadcast copy emitted first, then the reply itself.
    expect(messageCalls).toHaveLength(2)

    // Both events belong to the same channel.
    for (const call of messageCalls) {
      const topic = call[0] as string
      const event = call[1] as { channel_id: string }
      expect(topic).toBe(channelTopic('ch-1'))
      expect(event.channel_id).toBe('ch-1')
    }

    // The broadcast copy has root_id === '' (top-level).
    const broadcastCall = messageCalls.find((call) => {
      const event = call[1] as { payload: { root_id?: string } }
      return event.payload.root_id === ''
    })
    expect(broadcastCall).toBeDefined()
  })

  it('returns 200 and does not throw when publish fails (Redis outage)', async () => {
    m.mockPublish.mockRejectedValue(new Error('redis down'))
    const res = await callPost({ channel_id: 'ch-1', message: 'hello' })
    expect(res.status).toBe(200)
  })
})
