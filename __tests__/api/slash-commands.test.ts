/**
 * Integration tests: slash-commands registration + custom-command dispatch.
 *
 * Covers:
 *   - Registration returns signing_secret once (and not in subsequent GETs)
 *   - Dispatch POSTs a signed payload; signature is verifiable with the secret
 *   - Dispatch timeout → ephemeral error response (no throw)
 *   - http:// callback_url rejected at registration and dispatch
 *   - Private/loopback IP callback_url rejected at registration and dispatch
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'crypto'
import { promises as dns } from 'dns'
import {
  createTestContext, createTestUser, createTestChannel, asRequest,
  expectSuccess, cleanupTestData, TestContext, TestUser, TestChannel,
} from '../helpers'
import { verifySignature } from '@/lib/webhooks/webhookSigning'

let ctx: TestContext
let adminUser: TestUser
let channel: TestChannel
let wsId: string
const createdIds: string[] = []
const createdCommandIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()
  adminUser = await createTestUser(ctx.pool, { role: 'super_admin' })
  createdIds.push(adminUser.id)
  const { rows: [m] } = await ctx.pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.workspace_members WHERE user_id = $1 LIMIT 1`,
    [adminUser.id]
  )
  wsId = m.workspace_id
  channel = await createTestChannel(ctx.pool, adminUser.id, { workspaceId: wsId })
})

afterAll(async () => {
  if (createdCommandIds.length) {
    await ctx.pool.query(
      `DELETE FROM aaelink.slash_commands WHERE id = ANY($1)`,
      [createdCommandIds]
    )
  }
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

// ── Registration ──────────────────────────────────────────────────────

describe('slash-commands — registration', () => {
  it('returns signing_secret once on successful registration', async () => {
    const { POST } = await import('@/app/api/slash-commands/route')
    const name = `test-cmd-${randomUUID().slice(0, 8)}`
    const res = await POST(asRequest('POST', '/api/slash-commands', {
      cookie: adminUser.sessionCookie,
      body: {
        action: 'register',
        workspace_id: wsId,
        name,
        description: 'Test command',
        callback_url: 'https://example.test/cmd',
      },
    }))
    const data = await expectSuccess<{ command: { id: string }; signing_secret: string }>(res)
    expect(typeof data.signing_secret).toBe('string')
    // generateSigningSecret() returns a whsec_-prefixed, 32-byte-hex secret
    expect(data.signing_secret.startsWith('whsec_')).toBe(true)
    expect(data.signing_secret.slice('whsec_'.length).length).toBe(64) // 32 bytes hex
    expect(data.command.id).toBeTruthy()
    createdCommandIds.push(data.command.id)
  })

  it('does NOT expose signing_secret in GET list', async () => {
    const { GET } = await import('@/app/api/slash-commands/route')
    const res = await GET(asRequest('GET', `/api/slash-commands?workspace_id=${wsId}`, {
      cookie: adminUser.sessionCookie,
    }))
    const data = await expectSuccess<{ commands: Array<Record<string, unknown>> }>(res)
    for (const cmd of data.commands) {
      expect(cmd).not.toHaveProperty('signing_secret')
    }
  })

  it('rejects http:// callback_url at registration', async () => {
    const { POST } = await import('@/app/api/slash-commands/route')
    const res = await POST(asRequest('POST', '/api/slash-commands', {
      cookie: adminUser.sessionCookie,
      body: {
        action: 'register',
        workspace_id: wsId,
        name: `http-cmd-${randomUUID().slice(0, 8)}`,
        description: 'Bad URL',
        callback_url: 'http://example.test/cmd',
      },
    }))
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('callback_url_must_be_https')
  })

  it('rejects loopback IP callback_url at registration', async () => {
    const { POST } = await import('@/app/api/slash-commands/route')
    const res = await POST(asRequest('POST', '/api/slash-commands', {
      cookie: adminUser.sessionCookie,
      body: {
        action: 'register',
        workspace_id: wsId,
        name: `loopback-cmd-${randomUUID().slice(0, 8)}`,
        description: 'Private IP',
        callback_url: 'https://127.0.0.1/cmd',
      },
    }))
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('callback_url_private_ip_not_allowed')
  })

  it('rejects private network IP callback_url at registration', async () => {
    const { POST } = await import('@/app/api/slash-commands/route')
    const res = await POST(asRequest('POST', '/api/slash-commands', {
      cookie: adminUser.sessionCookie,
      body: {
        action: 'register',
        workspace_id: wsId,
        name: `private-cmd-${randomUUID().slice(0, 8)}`,
        description: 'Private IP',
        callback_url: 'https://192.168.1.100/cmd',
      },
    }))
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('callback_url_private_ip_not_allowed')
  })
})

// ── Dispatch ──────────────────────────────────────────────────────────

describe('slash-commands — dispatch', () => {
  let commandName: string
  let signingSecret: string

  beforeAll(async () => {
    // Register a fresh command for dispatch tests
    const { POST } = await import('@/app/api/slash-commands/route')
    commandName = `dispatch-cmd-${randomUUID().slice(0, 8)}`
    const res = await POST(asRequest('POST', '/api/slash-commands', {
      cookie: adminUser.sessionCookie,
      body: {
        action: 'register',
        workspace_id: wsId,
        name: commandName,
        description: 'Dispatch test',
        callback_url: 'https://example.test/dispatch',
      },
    }))
    const data = await expectSuccess<{ command: { id: string }; signing_secret: string }>(res)
    signingSecret = data.signing_secret
    createdCommandIds.push(data.command.id)
  })

  // Dispatch resolves the callback host via dns.promises.lookup and rejects
  // private targets. example.test does not resolve in CI, so pin it to a public
  // address for the tests that exercise the real fetch path. Literal-IP SSRF
  // tests below skip DNS entirely and are unaffected.
  beforeEach(() => {
    vi.spyOn(dns, 'lookup').mockResolvedValue(
      [{ address: '93.184.216.34', family: 4 }] as never
    )
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('posts signed payload and relays 2xx JSON response', async () => {
    const capturedRequests: { url: string; body: string; headers: Record<string, string> }[] = []

    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      capturedRequests.push({
        url,
        body: init.body as string,
        headers: init.headers as Record<string, string>,
      })
      return new Response(JSON.stringify({ response_type: 'in_channel', text: 'pong' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    try {
      const { POST } = await import('@/app/api/slash-commands/route')
      const res = await POST(asRequest('POST', '/api/slash-commands', {
        cookie: adminUser.sessionCookie,
        body: {
          action: 'execute',
          workspace_id: wsId,
          command: commandName,
          text: 'hello',
          channel_id: channel.id,
        },
      }))
      const data = await expectSuccess<{ response_type: string; text: string }>(res)
      expect(data.response_type).toBe('in_channel')
      expect(data.text).toBe('pong')

      // Verify the payload was posted with a valid signature
      expect(capturedRequests).toHaveLength(1)
      const req = capturedRequests[0]
      const sig = req.headers['x-aaelink-signature']
      const ts  = req.headers['x-aaelink-timestamp']
      expect(sig).toBeTruthy()
      expect(ts).toBeTruthy()
      const result = verifySignature(signingSecret, req.body, sig, ts)
      expect(result.valid).toBe(true)

      // Verify Slack-shaped payload fields
      const payload = JSON.parse(req.body) as Record<string, unknown>
      expect(payload.command).toBe(`/${commandName}`)
      expect(payload.text).toBe('hello')
      expect(payload.user_id).toBe(adminUser.id)
      expect(payload.channel_id).toBe(channel.id)
      expect(payload.workspace_id).toBe(wsId)
      expect(payload.response_url).toBeNull()
      expect(typeof payload.ts).toBe('string')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('returns ephemeral error on non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('Internal Server Error', { status: 500 })
    ))
    try {
      const { POST } = await import('@/app/api/slash-commands/route')
      const res = await POST(asRequest('POST', '/api/slash-commands', {
        cookie: adminUser.sessionCookie,
        body: {
          action: 'execute',
          workspace_id: wsId,
          command: commandName,
          text: '',
          channel_id: channel.id,
        },
      }))
      const data = await res.json() as { response_type: string; text: string }
      expect(data.response_type).toBe('ephemeral')
      expect(data.text).toContain('500')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('returns ephemeral error on timeout (AbortError)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      // Simulate the AbortController firing
      return new Promise<never>((_resolve, reject) => {
        if (init.signal) {
          init.signal.addEventListener('abort', () => {
            const err = new DOMException('The operation was aborted.', 'AbortError')
            reject(err)
          })
        }
        // Trigger abort after a short tick so the listener is attached
        setTimeout(() => (init.signal as AbortSignal & { abort?: () => void })?.dispatchEvent?.(new Event('abort')), 0)
      })
    }))
    try {
      const { POST } = await import('@/app/api/slash-commands/route')
      const res = await POST(asRequest('POST', '/api/slash-commands', {
        cookie: adminUser.sessionCookie,
        body: {
          action: 'execute',
          workspace_id: wsId,
          command: commandName,
          text: '',
          channel_id: channel.id,
        },
      }))
      const data = await res.json() as { response_type: string; text: string }
      expect(data.response_type).toBe('ephemeral')
      expect(data.text).toContain('timed out')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('returns ephemeral error on network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed')
    }))
    try {
      const { POST } = await import('@/app/api/slash-commands/route')
      const res = await POST(asRequest('POST', '/api/slash-commands', {
        cookie: adminUser.sessionCookie,
        body: {
          action: 'execute',
          workspace_id: wsId,
          command: commandName,
          text: '',
          channel_id: channel.id,
        },
      }))
      const data = await res.json() as { response_type: string; text: string }
      expect(data.response_type).toBe('ephemeral')
      expect(data.text).toContain('network error')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects http:// callback_url at dispatch time (stored before guard)', async () => {
    // Directly insert a command with an http:// url to simulate pre-guard data
    const id = randomUUID()
    const name = `legacy-http-${randomUUID().slice(0, 8)}`
    await ctx.pool.query(
      `INSERT INTO aaelink.slash_commands
         (id, workspace_id, name, description, usage_hint, callback_url, signing_secret, is_active, created_by, created_at)
       VALUES ($1, $2, $3, '', '', 'http://internal.corp/hook', '', true, $4, $5)`,
      [id, wsId, name, adminUser.id, Date.now()]
    )
    createdCommandIds.push(id)

    const { POST } = await import('@/app/api/slash-commands/route')
    const res = await POST(asRequest('POST', '/api/slash-commands', {
      cookie: adminUser.sessionCookie,
      body: {
        action: 'execute',
        workspace_id: wsId,
        command: name,
        text: '',
        channel_id: channel.id,
      },
    }))
    const data = await res.json() as { response_type: string; text: string }
    expect(data.response_type).toBe('ephemeral')
    expect(data.text).toContain('callback_url_must_be_https')
  })

  // Seed a command whose callback_url points directly at a private IP and assert
  // dispatch refuses to deliver. Covers stored-before-guard rows for each SSRF
  // bypass class: dotted private IPv4, IPv6 loopback literal, numeric non-dotted.
  async function seedAndDispatch(callbackUrl: string): Promise<{ response_type: string; text: string }> {
    const id = randomUUID()
    const name = `ssrf-${randomUUID().slice(0, 8)}`
    await ctx.pool.query(
      `INSERT INTO aaelink.slash_commands
         (id, workspace_id, name, description, usage_hint, callback_url, signing_secret, is_active, created_by, created_at)
       VALUES ($1, $2, $3, '', '', $4, 'whsec_seed', true, $5, $6)`,
      [id, wsId, name, callbackUrl, adminUser.id, Date.now()]
    )
    createdCommandIds.push(id)

    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const { POST } = await import('@/app/api/slash-commands/route')
      const res = await POST(asRequest('POST', '/api/slash-commands', {
        cookie: adminUser.sessionCookie,
        body: { action: 'execute', workspace_id: wsId, command: name, text: '', channel_id: channel.id },
      }))
      // Guard must short-circuit before any outbound fetch
      expect(fetchSpy).not.toHaveBeenCalled()
      return await res.json() as { response_type: string; text: string }
    } finally {
      vi.unstubAllGlobals()
    }
  }

  it('rejects private-IP callback_url at dispatch (stored before guard)', async () => {
    const data = await seedAndDispatch('https://10.0.0.5/hook')
    expect(data.response_type).toBe('ephemeral')
    expect(data.text).toContain('callback_url_private_ip_not_allowed')
  })

  it('rejects IPv6 loopback [::1] callback_url at dispatch', async () => {
    const data = await seedAndDispatch('https://[::1]/hook')
    expect(data.response_type).toBe('ephemeral')
    expect(data.text).toContain('callback_url_private_ip_not_allowed')
  })

  it('rejects numeric non-dotted host callback_url at dispatch', async () => {
    // 2130706433 === 127.0.0.1
    const data = await seedAndDispatch('https://2130706433/hook')
    expect(data.response_type).toBe('ephemeral')
    expect(data.text).toContain('callback_url_private_ip_not_allowed')
  })
})

// ── /who channel-membership authorization (IDOR guard) ─────────────────

describe('slash-commands — /who membership authz', () => {
  let privateChannel: TestChannel
  let memberUser: TestUser
  let outsiderUser: TestUser

  beforeAll(async () => {
    // A private ('P') channel in the shared workspace. createTestChannel adds the
    // creator as a channel_member; users not added are non-members.
    memberUser = await createTestUser(ctx.pool, { role: 'employee' })
    createdIds.push(memberUser.id)
    privateChannel = await createTestChannel(ctx.pool, memberUser.id, {
      type: 'private',
      workspaceId: wsId,
    })

    // Outsider belongs to the same workspace but NOT to the private channel.
    outsiderUser = await createTestUser(ctx.pool, { role: 'employee' })
    createdIds.push(outsiderUser.id)
  })

  it('denies a non-member /who on a private channel (no existence oracle)', async () => {
    const { POST } = await import('@/app/api/slash-commands/route')
    const res = await POST(asRequest('POST', '/api/slash-commands', {
      cookie: outsiderUser.sessionCookie,
      body: {
        action: 'execute',
        workspace_id: wsId,
        command: 'who',
        channel_id: privateChannel.id,
      },
    }))
    const data = await expectSuccess<{ response_type: string; text: string }>(res)
    expect(data.response_type).toBe('ephemeral')
    // Same response as an unknown channel — does not leak membership or existence.
    expect(data.text).not.toContain('Channel members')
    expect(data.text).not.toContain(`@${memberUser.id}`)
  })

  it('allows a member /who on a private channel', async () => {
    const { POST } = await import('@/app/api/slash-commands/route')
    const res = await POST(asRequest('POST', '/api/slash-commands', {
      cookie: memberUser.sessionCookie,
      body: {
        action: 'execute',
        workspace_id: wsId,
        command: 'who',
        channel_id: privateChannel.id,
      },
    }))
    const data = await expectSuccess<{ response_type: string; text: string }>(res)
    expect(data.response_type).toBe('ephemeral')
    expect(data.text).toContain('Channel members')
  })
})
