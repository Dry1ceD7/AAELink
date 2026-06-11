/**
 * AAELink — push delivery (FCM HTTP v1) tests.
 *
 * Covers token selection, FCM payload shaping, the graceful no-credential
 * no-op path, and stale-token cleanup. `fetch` and the pg pool are injected,
 * so no global mocking or live DB is required.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Pool } from 'pg'
import { buildFcmMessage, deliverPush } from '@/lib/notifications/pushDelivery'
import { _resetFcmTokenCache } from '@/lib/notifications/fcmAuth'

type Row = { id: string; token: string; provider: string }

/** Minimal fake pool: returns the given token rows on SELECT, records updates. */
function fakePool(tokens: Row[]) {
  const staleUpdates: string[][] = []
  const pool = {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      if (/UPDATE aaelink.push_tokens SET is_active = false/.test(sql)) {
        staleUpdates.push(params[0] as string[])
        return { rows: [] }
      }
      if (/SELECT id, token, provider FROM aaelink.push_tokens/.test(sql)) {
        return { rows: tokens }
      }
      return { rows: [] }
    }),
  } as unknown as Pool
  return { pool, staleUpdates }
}

function okResponse() {
  return { ok: true, status: 200, json: async () => ({ name: 'projects/x/messages/1' }) }
}
function errResponse(status: number, errorStatus?: string) {
  return {
    ok: false,
    status,
    json: async () => (errorStatus ? { error: { status: errorStatus } } : {}),
  }
}

const ENV_KEYS = [
  'FCM_PROJECT_ID', 'FCM_ACCESS_TOKEN', 'FCM_SERVICE_ACCOUNT_JSON',
  'APNS_AUTH_KEY', 'APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_BUNDLE_ID',
]

beforeEach(() => {
  _resetFcmTokenCache()
  for (const k of ENV_KEYS) delete process.env[k]
})

describe('buildFcmMessage', () => {
  it('shapes a visible notification with title/body and data', () => {
    const m = buildFcmMessage('tok1', {
      title: 'Hi', body: 'There', channel_id: 'c1', badge_count: 3, priority: 'high',
    }) as { message: { token: string; notification?: { title: string; body: string }; data: Record<string, string>; android: { priority: string } } }
    expect(m.message.token).toBe('tok1')
    expect(m.message.notification).toEqual({ title: 'Hi', body: 'There' })
    expect(m.message.data.channel_id).toBe('c1')
    expect(m.message.data.badge).toBe('3')
    expect(m.message.android.priority).toBe('high')
  })

  it('omits the notification block for silent (data-only) pushes', () => {
    const m = buildFcmMessage('tok1', { silent: true, channel_id: 'c2' }) as { message: { notification?: unknown; android: { priority: string } } }
    expect(m.message.notification).toBeUndefined()
    expect(m.message.android.priority).toBe('normal')
  })
})

describe('deliverPush — token selection', () => {
  it('returns early with no tokens when user has none', async () => {
    process.env.FCM_PROJECT_ID = 'proj'
    process.env.FCM_ACCESS_TOKEN = 'bearer'
    const { pool } = fakePool([])
    const fetchMock = vi.fn()
    const r = await deliverPush(pool, { user_id: 'u1', title: 'x' }, fetchMock as unknown as typeof fetch)
    expect(r.sent).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends one FCM request per active fcm token', async () => {
    process.env.FCM_PROJECT_ID = 'proj'
    process.env.FCM_ACCESS_TOKEN = 'bearer'
    const { pool } = fakePool([
      { id: 't1', token: 'a', provider: 'fcm' },
      { id: 't2', token: 'b', provider: 'web' },
    ])
    const fetchMock = vi.fn((_url: string) => Promise.resolve(okResponse()))
    const r = await deliverPush(pool, { user_id: 'u1', title: 'Hi' }, fetchMock as unknown as typeof fetch)
    expect(r.sent).toBe(2)
    expect(r.failed).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const url = fetchMock.mock.calls[0][0]
    expect(url).toBe('https://fcm.googleapis.com/v1/projects/proj/messages:send')
  })
})

describe('deliverPush — graceful no-cred path', () => {
  it('no-ops without throwing or calling fetch when FCM creds are absent', async () => {
    // FCM_PROJECT_ID unset
    const { pool } = fakePool([{ id: 't1', token: 'a', provider: 'fcm' }])
    const fetchMock = vi.fn()
    const r = await deliverPush(pool, { user_id: 'u1', title: 'x' }, fetchMock as unknown as typeof fetch)
    expect(r.no_creds).toBe(true)
    expect(r.sent).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips APNS tokens (apns_unconfigured) instead of faking delivery', async () => {
    process.env.FCM_PROJECT_ID = 'proj'
    process.env.FCM_ACCESS_TOKEN = 'bearer'
    const { pool } = fakePool([{ id: 't1', token: 'a', provider: 'apns' }])
    const fetchMock = vi.fn(async () => okResponse())
    const r = await deliverPush(pool, { user_id: 'u1', title: 'x' }, fetchMock as unknown as typeof fetch)
    expect(r.skipped_apns).toBe(1)
    expect(r.sent).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('deliverPush — stale token cleanup', () => {
  it('marks UNREGISTERED tokens inactive and does not fail the whole job', async () => {
    process.env.FCM_PROJECT_ID = 'proj'
    process.env.FCM_ACCESS_TOKEN = 'bearer'
    const { pool, staleUpdates } = fakePool([
      { id: 'good', token: 'a', provider: 'fcm' },
      { id: 'bad', token: 'b', provider: 'fcm' },
    ])
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      const parsed = JSON.parse(init.body) as { message: { token: string } }
      return parsed.message.token === 'b'
        ? errResponse(404, 'UNREGISTERED')
        : okResponse()
    })
    const r = await deliverPush(pool, { user_id: 'u1', title: 'x' }, fetchMock as unknown as typeof fetch)
    expect(r.sent).toBe(1)
    expect(r.stale).toBe(1)
    expect(staleUpdates).toEqual([['bad']])
  })

  it('counts transient (500) errors as failed without marking stale', async () => {
    process.env.FCM_PROJECT_ID = 'proj'
    process.env.FCM_ACCESS_TOKEN = 'bearer'
    const { pool, staleUpdates } = fakePool([{ id: 't1', token: 'a', provider: 'fcm' }])
    const fetchMock = vi.fn(async () => errResponse(500, 'INTERNAL'))
    const r = await deliverPush(pool, { user_id: 'u1', title: 'x' }, fetchMock as unknown as typeof fetch)
    expect(r.failed).toBe(1)
    expect(r.stale).toBe(0)
    expect(staleUpdates).toEqual([])
  })
})
