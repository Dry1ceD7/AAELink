/**
 * Integration tests for the real OAuth2 authorization-code flow (Slack oauth.v2
 * parity): GET/POST /api/oauth/authorize → POST /api/oauth/access (exchange).
 *
 * Covers the happy path (authorize → exchange → token introspects), wrong
 * client_secret, redirect_uri mismatch, expired code, single-use code reuse,
 * state passthrough, and the unauthenticated-authorize guard.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID, randomBytes } from 'crypto'
import {
  createTestContext,
  createTestUser,
  asRequest,
  parseResponse,
  TestContext,
  TestUser,
} from '../helpers'
import { GET as AUTHORIZE_GET, POST as AUTHORIZE_POST } from '@/app/api/oauth/authorize/route'
import { POST as ACCESS_POST, GET as ACCESS_GET } from '@/app/api/oauth/access/route'
import { hashAppSecret } from '@/lib/auth/oauthAppSecret'

let ctx: TestContext
let user: TestUser
const userIds: string[] = []
const appIds: string[] = []

const REDIRECT_URI = 'https://app.example.com/oauth/callback'
const OTHER_REDIRECT = 'https://evil.example.com/callback'
const CLIENT_SECRET = 'super-secret-value'

async function mkApp(opts: {
  scopes?: string
  redirectUris?: string[]
  secret?: string
} = {}): Promise<{ id: string; client_id: string }> {
  const id = randomUUID()
  const clientId = `client_${randomBytes(8).toString('hex')}`
  await ctx.pool.query(
    `INSERT INTO aaelink.oauth_apps
       (id, name, client_id, client_secret, redirect_uris, scopes, is_active, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8)`,
    [
      id,
      'Test App',
      clientId,
      opts.secret ?? CLIENT_SECRET,
      opts.redirectUris ?? [REDIRECT_URI],
      opts.scopes ?? 'chat:write channels:read',
      user.id,
      Date.now(),
    ],
  )
  appIds.push(id)
  return { id, client_id: clientId }
}

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(user.id)
})

afterAll(async () => {
  if (appIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.oauth_codes WHERE app_id = ANY($1)`, [appIds])
    await ctx.pool.query(`DELETE FROM aaelink.oauth_tokens WHERE app_id = ANY($1)`, [appIds])
    await ctx.pool.query(`DELETE FROM aaelink.oauth_apps WHERE id = ANY($1)`, [appIds])
  }
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('GET /api/oauth/authorize', () => {
  it('requires a session', async () => {
    const app = await mkApp()
    const req = asRequest('GET', '/api/oauth/authorize', {
      query: { client_id: app.client_id, redirect_uri: REDIRECT_URI },
    })
    const res = await AUTHORIZE_GET(req)
    expect(res.status).toBe(401)
    expect((await parseResponse(res)).error).toBe('unauthorized')
  })

  it('404s for an unknown client', async () => {
    const req = asRequest('GET', '/api/oauth/authorize', {
      cookie: user.sessionCookie,
      query: { client_id: 'does-not-exist', redirect_uri: REDIRECT_URI },
    })
    const res = await AUTHORIZE_GET(req)
    expect(res.status).toBe(404)
    expect((await parseResponse(res)).error).toBe('unknown_client')
  })

  it('400s on redirect_uri mismatch', async () => {
    const app = await mkApp()
    const req = asRequest('GET', '/api/oauth/authorize', {
      cookie: user.sessionCookie,
      query: { client_id: app.client_id, redirect_uri: OTHER_REDIRECT },
    })
    const res = await AUTHORIZE_GET(req)
    expect(res.status).toBe(400)
    expect((await parseResponse(res)).error).toBe('redirect_uri_mismatch')
  })

  it('returns consent info with the intersected scope', async () => {
    const app = await mkApp({ scopes: 'chat:write channels:read users:read' })
    const req = asRequest('GET', '/api/oauth/authorize', {
      cookie: user.sessionCookie,
      query: { client_id: app.client_id, redirect_uri: REDIRECT_URI, scope: 'chat:write nope:scope' },
    })
    const res = await AUTHORIZE_GET(req)
    expect(res.status).toBe(200)
    const body = await parseResponse<{ app: { name: string; client_id: string; scope: string }; redirect_uri: string }>(res)
    expect(body.app.client_id).toBe(app.client_id)
    expect(body.app.name).toBe('Test App')
    expect(body.app.scope).toBe('chat:write') // nope:scope dropped (not registered)
    expect(body.redirect_uri).toBe(REDIRECT_URI)
  })
})

describe('POST /api/oauth/authorize + exchange (happy path)', () => {
  it('issues a code, exchanges it for a token, and the token introspects', async () => {
    const app = await mkApp({ scopes: 'chat:write channels:read' })

    const authRes = await AUTHORIZE_POST(asRequest('POST', '/api/oauth/authorize', {
      cookie: user.sessionCookie,
      body: { client_id: app.client_id, redirect_uri: REDIRECT_URI, scope: 'chat:write' },
    }))
    expect(authRes.status).toBe(200)
    const auth = await parseResponse<{ ok: boolean; code: string; redirect_to: string }>(authRes)
    expect(auth.ok).toBe(true)
    expect(auth.code).toBeTruthy()
    expect(auth.redirect_to).toContain(`code=${auth.code}`)

    const exchangeRes = await ACCESS_POST(asRequest('POST', '/api/oauth/access', {
      cookie: user.sessionCookie,
      body: {
        action: 'exchange',
        code: auth.code,
        client_id: app.client_id,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
      },
    }))
    expect(exchangeRes.status).toBe(200)
    const ex = await parseResponse<{
      ok: boolean; access_token: string; token_type: string; scope: string
      app_id: string; expires_at: number; authed_user: { id: string }
    }>(exchangeRes)
    expect(ex.ok).toBe(true)
    expect(ex.access_token.startsWith('xoxp-')).toBe(true) // user-delegated token
    expect(ex.token_type).toBe('user') // a real user delegation, not a bot
    expect(ex.scope).toBe('chat:write')
    expect(ex.app_id).toBe(app.id)
    expect(ex.authed_user.id).toBe(user.id) // a real user token, not a fabricated bot id
    // The token has a finite lifetime (not the 0 "never expires" sentinel) so
    // the worker prune and the requireScope/introspect expiry checks can apply.
    expect(ex.expires_at).toBeGreaterThan(Date.now())

    // The minted token introspects as the same grant, with its finite expiry.
    const introspectRes = await ACCESS_GET(asRequest('GET', '/api/oauth/access', {
      cookie: user.sessionCookie,
      query: { token: ex.access_token },
    }))
    expect(introspectRes.status).toBe(200)
    const info = await parseResponse<{
      ok: boolean; token_type: string; user_id: string; scope: string
      app_id: string; expires_at: number
    }>(introspectRes)
    expect(info.ok).toBe(true)
    expect(info.token_type).toBe('user')
    expect(info.user_id).toBe(user.id)
    expect(info.scope).toBe('chat:write')
    expect(info.app_id).toBe(app.id)
    expect(info.expires_at).toBe(ex.expires_at)
  })

  it('passes state through verbatim only when provided', async () => {
    const app = await mkApp()
    const state = 'opaque state/with?special&chars'
    const withState = await parseResponse<{ redirect_to: string }>(
      await AUTHORIZE_POST(asRequest('POST', '/api/oauth/authorize', {
        cookie: user.sessionCookie,
        body: { client_id: app.client_id, redirect_uri: REDIRECT_URI, state },
      })),
    )
    const url = new URL(withState.redirect_to)
    expect(url.searchParams.get('state')).toBe(state)

    const noState = await parseResponse<{ redirect_to: string }>(
      await AUTHORIZE_POST(asRequest('POST', '/api/oauth/authorize', {
        cookie: user.sessionCookie,
        body: { client_id: app.client_id, redirect_uri: REDIRECT_URI },
      })),
    )
    expect(new URL(noState.redirect_to).searchParams.has('state')).toBe(false)
  })

  it('requires a session to issue a code', async () => {
    const app = await mkApp()
    const res = await AUTHORIZE_POST(asRequest('POST', '/api/oauth/authorize', {
      body: { client_id: app.client_id, redirect_uri: REDIRECT_URI },
    }))
    expect(res.status).toBe(401)
    expect((await parseResponse(res)).error).toBe('unauthorized')
  })
})

describe('POST /api/oauth/access exchange — rejections', () => {
  async function issueCode(app: { client_id: string }): Promise<string> {
    const res = await AUTHORIZE_POST(asRequest('POST', '/api/oauth/authorize', {
      cookie: user.sessionCookie,
      body: { client_id: app.client_id, redirect_uri: REDIRECT_URI, scope: 'chat:write' },
    }))
    return (await parseResponse<{ code: string }>(res)).code
  }

  it('rejects a wrong client_secret with 401 invalid_client (no dev fallback) and leaves the code usable', async () => {
    const app = await mkApp()
    const code = await issueCode(app)
    const res = await ACCESS_POST(asRequest('POST', '/api/oauth/access', {
      cookie: user.sessionCookie,
      body: {
        action: 'exchange', code, client_id: app.client_id,
        client_secret: 'wrong-secret', redirect_uri: REDIRECT_URI,
      },
    }))
    expect(res.status).toBe(401)
    expect((await parseResponse(res)).error).toBe('invalid_client')

    // The secret check runs BEFORE the code-consume UPDATE, so a bad-secret
    // guess must NOT burn a still-valid pending code: the real owner can still
    // exchange it with the correct secret.
    const legit = await ACCESS_POST(asRequest('POST', '/api/oauth/access', {
      cookie: user.sessionCookie,
      body: {
        action: 'exchange', code, client_id: app.client_id,
        client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI,
      },
    }))
    expect(legit.status).toBe(200)
  })

  it('rejects an unknown client with 401 invalid_client', async () => {
    const res = await ACCESS_POST(asRequest('POST', '/api/oauth/access', {
      cookie: user.sessionCookie,
      body: {
        action: 'exchange', code: 'whatever', client_id: 'ghost-client',
        client_secret: 'x', redirect_uri: REDIRECT_URI,
      },
    }))
    expect(res.status).toBe(401)
    expect((await parseResponse(res)).error).toBe('invalid_client')
  })

  it('rejects a redirect_uri mismatch at exchange with 400 invalid_grant and leaves the code live', async () => {
    // Register both URIs so authorize succeeds, then exchange with the other one.
    const app = await mkApp({ redirectUris: [REDIRECT_URI, OTHER_REDIRECT] })
    const code = await issueCode(app) // issued bound to REDIRECT_URI
    const res = await ACCESS_POST(asRequest('POST', '/api/oauth/access', {
      cookie: user.sessionCookie,
      body: {
        action: 'exchange', code, client_id: app.client_id,
        client_secret: CLIENT_SECRET, redirect_uri: OTHER_REDIRECT,
      },
    }))
    expect(res.status).toBe(400)
    expect((await parseResponse(res)).error).toBe('invalid_grant')

    // redirect_uri is folded into the atomic consume WHERE, so a mismatch matches
    // no row and does NOT burn the code (same DoS-resistance as the client
    // dimension). The legitimate redirect_uri must still exchange the live code.
    const legit = await ACCESS_POST(asRequest('POST', '/api/oauth/access', {
      cookie: user.sessionCookie,
      body: {
        action: 'exchange', code, client_id: app.client_id,
        client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI,
      },
    }))
    expect(legit.status).toBe(200)
  })

  it('rejects an expired code with 400 invalid_code', async () => {
    const app = await mkApp()
    const code = await issueCode(app)
    // Force-expire the code in the store.
    await ctx.pool.query(
      `UPDATE aaelink.oauth_codes SET expires_at = $2 WHERE code = $1`,
      [code, Date.now() - 1000],
    )
    const res = await ACCESS_POST(asRequest('POST', '/api/oauth/access', {
      cookie: user.sessionCookie,
      body: {
        action: 'exchange', code, client_id: app.client_id,
        client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI,
      },
    }))
    expect(res.status).toBe(400)
    expect((await parseResponse(res)).error).toBe('invalid_code')
  })

  it('rejects code reuse — the second exchange fails with 400 invalid_code', async () => {
    const app = await mkApp()
    const code = await issueCode(app)
    const body = {
      action: 'exchange' as const, code, client_id: app.client_id,
      client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI,
    }
    const first = await ACCESS_POST(asRequest('POST', '/api/oauth/access', {
      cookie: user.sessionCookie, body,
    }))
    expect(first.status).toBe(200)

    const second = await ACCESS_POST(asRequest('POST', '/api/oauth/access', {
      cookie: user.sessionCookie, body,
    }))
    expect(second.status).toBe(400)
    expect((await parseResponse(second)).error).toBe('invalid_code')
  })

  it('rejects a missing redirect_uri with 400 invalid_request', async () => {
    const app = await mkApp()
    const code = await issueCode(app)
    const res = await ACCESS_POST(asRequest('POST', '/api/oauth/access', {
      cookie: user.sessionCookie,
      body: {
        action: 'exchange', code, client_id: app.client_id, client_secret: CLIENT_SECRET,
      },
    }))
    expect(res.status).toBe(400)
    expect((await parseResponse(res)).error).toBe('invalid_request')
  })

  // SECURITY (client substitution / code-binding DoS): a code issued to app A,
  // exchanged with app B's credentials, must be REJECTED and must NOT burn A's
  // code — A must still be able to exchange it. The binding check lives inside
  // the atomic consume WHERE clause, so a mismatched request matches no row.
  it('rejects exchange with another app\'s credentials and leaves the code usable by its owner', async () => {
    const appA = await mkApp()
    const appB = await mkApp({ secret: 'app-b-secret' })
    const code = await issueCode(appA)

    // App B tries to exchange app A's code with B's own (valid, but wrong-app)
    // credentials. invalid_grant per RFC 6749 (don't leak which field), and the
    // code must survive.
    const substituted = await ACCESS_POST(asRequest('POST', '/api/oauth/access', {
      cookie: user.sessionCookie,
      body: {
        action: 'exchange', code, client_id: appB.client_id,
        client_secret: 'app-b-secret', redirect_uri: REDIRECT_URI,
      },
    }))
    expect(substituted.status).toBe(400)
    expect((await parseResponse(substituted)).error).toBe('invalid_grant')

    // The legitimate owner (app A) can still exchange the un-burned code.
    const legit = await ACCESS_POST(asRequest('POST', '/api/oauth/access', {
      cookie: user.sessionCookie,
      body: {
        action: 'exchange', code, client_id: appA.client_id,
        client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI,
      },
    }))
    expect(legit.status).toBe(200)
    expect((await parseResponse<{ ok: boolean; app_id: string }>(legit)).app_id).toBe(appA.id)
  })

  it('rejects exchange when the wrong client_id presents the right secret (code survives)', async () => {
    const appA = await mkApp()
    const appB = await mkApp() // same CLIENT_SECRET, different client_id
    const code = await issueCode(appA)

    const wrongClient = await ACCESS_POST(asRequest('POST', '/api/oauth/access', {
      cookie: user.sessionCookie,
      body: {
        action: 'exchange', code, client_id: appB.client_id,
        client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI,
      },
    }))
    expect(wrongClient.status).toBe(400)
    expect((await parseResponse(wrongClient)).error).toBe('invalid_grant')

    // Code still exchangeable by app A.
    const legit = await ACCESS_POST(asRequest('POST', '/api/oauth/access', {
      cookie: user.sessionCookie,
      body: {
        action: 'exchange', code, client_id: appA.client_id,
        client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI,
      },
    }))
    expect(legit.status).toBe(200)
  })
})

describe('POST /api/oauth/access exchange — client_secret hashing + back-compat', () => {
  async function issueCode(app: { client_id: string }): Promise<string> {
    const res = await AUTHORIZE_POST(asRequest('POST', '/api/oauth/authorize', {
      cookie: user.sessionCookie,
      body: { client_id: app.client_id, redirect_uri: REDIRECT_URI, scope: 'chat:write' },
    }))
    return (await parseResponse<{ code: string }>(res)).code
  }

  async function storedSecret(appId: string): Promise<string> {
    const { rows } = await ctx.pool.query<{ client_secret: string }>(
      `SELECT client_secret FROM aaelink.oauth_apps WHERE id = $1`,
      [appId],
    )
    return rows[0]?.client_secret ?? ''
  }

  it('exchanges against a pre-hashed client_secret', async () => {
    const app = await mkApp({ secret: hashAppSecret(CLIENT_SECRET) })
    const code = await issueCode(app)
    const res = await ACCESS_POST(asRequest('POST', '/api/oauth/access', {
      cookie: user.sessionCookie,
      body: {
        action: 'exchange', code, client_id: app.client_id,
        client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI,
      },
    }))
    expect(res.status).toBe(200)
    // Already hashed — stays hashed, unchanged.
    expect(await storedSecret(app.id)).toBe(hashAppSecret(CLIENT_SECRET))
  })

  it('rejects a wrong secret against a hashed row with 401 invalid_client and keeps the code live', async () => {
    const app = await mkApp({ secret: hashAppSecret(CLIENT_SECRET) })
    const code = await issueCode(app)
    const res = await ACCESS_POST(asRequest('POST', '/api/oauth/access', {
      cookie: user.sessionCookie,
      body: {
        action: 'exchange', code, client_id: app.client_id,
        client_secret: 'wrong-secret', redirect_uri: REDIRECT_URI,
      },
    }))
    expect(res.status).toBe(401)
    expect((await parseResponse(res)).error).toBe('invalid_client')

    // A bad-secret guess against a hashed row also returns before the consume —
    // the code survives and the correct secret still exchanges it.
    const legit = await ACCESS_POST(asRequest('POST', '/api/oauth/access', {
      cookie: user.sessionCookie,
      body: {
        action: 'exchange', code, client_id: app.client_id,
        client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI,
      },
    }))
    expect(legit.status).toBe(200)
  })

  it('verifies a legacy plaintext row and lazily upgrades it to a hash in place', async () => {
    // mkApp stores CLIENT_SECRET as plaintext (legacy shape).
    const app = await mkApp()
    expect(await storedSecret(app.id)).toBe(CLIENT_SECRET) // plaintext on disk

    const code = await issueCode(app)
    const res = await ACCESS_POST(asRequest('POST', '/api/oauth/access', {
      cookie: user.sessionCookie,
      body: {
        action: 'exchange', code, client_id: app.client_id,
        client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI,
      },
    }))
    expect(res.status).toBe(200)
    // The row was lazily upgraded to the hashed form on successful verify.
    expect(await storedSecret(app.id)).toBe(hashAppSecret(CLIENT_SECRET))

    // And it still verifies after upgrade (now via the hashed path).
    const code2 = await issueCode(app)
    const res2 = await ACCESS_POST(asRequest('POST', '/api/oauth/access', {
      cookie: user.sessionCookie,
      body: {
        action: 'exchange', code: code2, client_id: app.client_id,
        client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI,
      },
    }))
    expect(res2.status).toBe(200)
  })
})
