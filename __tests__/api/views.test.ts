/**
 * Integration tests for the views/modals API (Integrations parity §28).
 *
 * Exercises the route (app/api/views) against a live Postgres + the lib
 * (lib/apps/views, lib/apps/viewTriggers). Coverage:
 *   - open persists a view, emits over realtime, and CONSUMES the trigger_id
 *   - a reused trigger_id is rejected 400 (single-use enforcement)
 *   - an invalid / unknown trigger_id is rejected 400
 *   - push stacks a view onto an existing modal's root
 *   - update mutates an existing view
 *   - publish upserts the Home-tab view per (app, user)
 *   - malformed Block Kit blocks are rejected 400
 *
 * Each assertion fails if the corresponding enforcement is removed (e.g. drop
 * trigger consumption → the reuse test would 200 twice; drop block validation →
 * the malformed-blocks test would 200).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, asRequest, type TestContext, type TestUser } from '../helpers'
import { getPubSub, userTopic } from '@/lib/realtime/redisPubSub'
import { mintViewTrigger } from '@/lib/apps/viewTriggers'
import { POST } from '@/app/api/views/route'

let ctx: TestContext
let owner: TestUser
const userIds: string[] = []
const botIds: string[] = []

async function mkBot(createdBy: string): Promise<string> {
  const id = `B${randomUUID().replace(/-/g, '')}`
  await ctx.pool.query(
    `INSERT INTO aaelink.bot_users (id, name, created_by, created_at) VALUES ($1, 'TestBot', $2, $3)`,
    [id, createdBy, Date.now()]
  )
  botIds.push(id)
  return id
}

const goodView = (type: 'modal' | 'home' = 'modal') => ({
  type,
  title: { type: 'plain_text', text: 'Hi' },
  blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'hello' } }],
})

beforeAll(async () => {
  ctx = await createTestContext()
  owner = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(owner.id)
})

afterAll(async () => {
  if (botIds.length) await ctx.pool.query(`DELETE FROM aaelink.bot_users WHERE id = ANY($1)`, [botIds])
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('POST /api/views — open', () => {
  it('persists the view, emits over realtime, and consumes the trigger_id', async () => {
    const botId = await mkBot(owner.id)
    const triggerId = await mintViewTrigger(ctx.pool, { botId, userId: owner.id })

    let emitted: unknown = null
    const unsub = getPubSub().subscribe(userTopic(owner.id), (e) => { emitted = e })

    const res = await POST(asRequest('POST', '/api/views', {
      cookie: owner.sessionCookie,
      body: { action: 'open', bot_id: botId, trigger_id: triggerId, view: goodView() },
    }))
    unsub()
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; view: { id: string; type: string; root_view_id: string } }
    expect(body.ok).toBe(true)
    expect(body.view.type).toBe('modal')
    expect(body.view.root_view_id).toBe(body.view.id)

    // persisted
    const { rows } = await ctx.pool.query(`SELECT id FROM aaelink.app_views WHERE id = $1`, [body.view.id])
    expect(rows[0]?.id).toBe(body.view.id)

    // emitted to the bound user's topic
    expect(emitted).toMatchObject({ type: 'notification', user_id: owner.id })

    // trigger consumed
    const { rows: trg } = await ctx.pool.query(
      `SELECT consumed_at FROM aaelink.view_triggers WHERE id = $1`, [triggerId]
    )
    expect(trg[0]?.consumed_at).not.toBeNull()
  })

  it('rejects a reused trigger_id (single-use)', async () => {
    const botId = await mkBot(owner.id)
    const triggerId = await mintViewTrigger(ctx.pool, { botId, userId: owner.id })
    const mk = () => POST(asRequest('POST', '/api/views', {
      cookie: owner.sessionCookie,
      body: { action: 'open', bot_id: botId, trigger_id: triggerId, view: goodView() },
    }))
    const first = await mk()
    expect(first.status).toBe(200)
    const second = await mk()
    expect(second.status).toBe(400)
    expect((await second.json() as { error: string }).error).toBe('trigger_already_used')
  })

  it('rejects an unknown trigger_id', async () => {
    const res = await POST(asRequest('POST', '/api/views', {
      cookie: owner.sessionCookie,
      body: { action: 'open', trigger_id: 'does-not-exist', view: goodView() },
    }))
    expect(res.status).toBe(400)
    expect((await res.json() as { error: string }).error).toBe('invalid_trigger_id')
  })

  it('rejects malformed Block Kit blocks', async () => {
    const botId = await mkBot(owner.id)
    const triggerId = await mintViewTrigger(ctx.pool, { botId, userId: owner.id })
    const res = await POST(asRequest('POST', '/api/views', {
      cookie: owner.sessionCookie,
      body: {
        action: 'open', bot_id: botId, trigger_id: triggerId,
        view: { type: 'modal', blocks: [{ type: 'not_a_real_block' }] },
      },
    }))
    expect(res.status).toBe(400)
    expect((await res.json() as { error: string }).error).toBe('invalid_blocks')
  })
})

describe('POST /api/views — push / update / publish', () => {
  async function openRoot(botId: string): Promise<string> {
    const triggerId = await mintViewTrigger(ctx.pool, { botId, userId: owner.id })
    const res = await POST(asRequest('POST', '/api/views', {
      cookie: owner.sessionCookie,
      body: { action: 'open', bot_id: botId, trigger_id: triggerId, view: goodView() },
    }))
    return (await res.json() as { view: { id: string } }).view.id
  }

  it('push stacks a view onto an existing modal', async () => {
    const botId = await mkBot(owner.id)
    const rootId = await openRoot(botId)
    const triggerId = await mintViewTrigger(ctx.pool, { botId, userId: owner.id })
    const res = await POST(asRequest('POST', '/api/views', {
      cookie: owner.sessionCookie,
      body: { action: 'push', bot_id: botId, trigger_id: triggerId, view_id: rootId, view: goodView() },
    }))
    expect(res.status).toBe(200)
    const view = (await res.json() as { view: { id: string; root_view_id: string; parent_view_id: string } }).view
    expect(view.root_view_id).toBe(rootId)
    expect(view.parent_view_id).toBe(rootId)
    expect(view.id).not.toBe(rootId)
  })

  it('update mutates an existing view', async () => {
    const botId = await mkBot(owner.id)
    const rootId = await openRoot(botId)
    const newView = { type: 'modal' as const, title: { type: 'plain_text', text: 'Updated' },
      blocks: [{ type: 'divider' }] }
    const res = await POST(asRequest('POST', '/api/views', {
      cookie: owner.sessionCookie,
      body: { action: 'update', bot_id: botId, view_id: rootId, view: newView },
    }))
    expect(res.status).toBe(200)
    const { rows } = await ctx.pool.query<{ view: { title: { text: string } } }>(
      `SELECT view FROM aaelink.app_views WHERE id = $1`, [rootId]
    )
    expect(rows[0]?.view.title.text).toBe('Updated')
  })

  it('publish upserts the home view per (app, user)', async () => {
    const botId = await mkBot(owner.id)
    const target = await createTestUser(ctx.pool, { role: 'employee' })
    userIds.push(target.id)
    const mk = (text: string) => POST(asRequest('POST', '/api/views', {
      cookie: owner.sessionCookie,
      body: { action: 'publish', bot_id: botId, user_id: target.id,
        view: { type: 'home', blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] } },
    }))
    const first = await mk('v1')
    expect(first.status).toBe(200)
    const second = await mk('v2')
    expect(second.status).toBe(200)
    // upsert: exactly ONE home view for this (bot, user) and the latest content won.
    const { rows: all } = await ctx.pool.query<{ view: { blocks: Array<{ text: { text: string } }> } }>(
      `SELECT view FROM aaelink.app_views WHERE bot_id = $1 AND user_id = $2 AND type = 'home'`,
      [botId, target.id]
    )
    expect(all).toHaveLength(1)
    expect(all[0].view.blocks[0].text.text).toBe('v2')
  })

  it('rejects publish with a non-home view type', async () => {
    const botId = await mkBot(owner.id)
    const res = await POST(asRequest('POST', '/api/views', {
      cookie: owner.sessionCookie,
      body: { action: 'publish', bot_id: botId, user_id: owner.id, view: goodView('modal') },
    }))
    expect(res.status).toBe(400)
    expect((await res.json() as { error: string }).error).toBe('view_type_must_be_home')
  })

  it('forbids acting as a bot the session user does not own', async () => {
    const other = await createTestUser(ctx.pool, { role: 'employee' })
    userIds.push(other.id)
    const botId = await mkBot(other.id) // owned by `other`
    const triggerId = await mintViewTrigger(ctx.pool, { botId, userId: owner.id })
    const res = await POST(asRequest('POST', '/api/views', {
      cookie: owner.sessionCookie, // acting as owner, not the bot's owner
      body: { action: 'open', bot_id: botId, trigger_id: triggerId, view: goodView() },
    }))
    expect(res.status).toBe(403)
    expect((await res.json() as { error: string }).error).toBe('forbidden')
  })

  // ── SECURITY: non-owner IDOR tests ────────────────────────────────

  it('rejects a non-owner update via view_id (IDOR fix)', async () => {
    // victim opens a view with their own bot
    const victim = await createTestUser(ctx.pool, { role: 'employee' })
    userIds.push(victim.id)
    const victimBotId = await mkBot(victim.id)

    // open a view as victim (direct DB insert — victim has their own session but we
    // exercise the attack via owner's session so we insert the view directly)
    const viewId = `V${(await import('crypto')).randomUUID().replace(/-/g, '')}`
    const now = Date.now()
    await ctx.pool.query(
      `INSERT INTO aaelink.app_views
         (id, bot_id, app_id, user_id, channel_id, workspace_id, type, root_view_id,
          parent_view_id, external_id, view, state, hash, created_at, updated_at)
       VALUES ($1,$2,NULL,$3,NULL,NULL,'modal',$1,NULL,NULL,$4,'{"values":{}}',$5,$6,$6)`,
      [viewId, victimBotId, victim.id, JSON.stringify(goodView()), `${now}.abcdef`, now]
    )

    // attacker (owner) tries to update victim's view by passing its view_id and
    // owner's own bot_id — this would succeed before the IDOR fix
    const attackerBotId = await mkBot(owner.id)
    const res = await POST(asRequest('POST', '/api/views', {
      cookie: owner.sessionCookie,
      body: {
        action: 'update',
        bot_id: attackerBotId,
        view_id: viewId,
        view: { type: 'modal' as const, title: { type: 'plain_text', text: 'pwned' }, blocks: [] },
      },
    }))
    // must be rejected — 404 gives no existence oracle
    expect(res.status).toBe(404)

    // confirm the victim's view was NOT mutated
    const { rows } = await ctx.pool.query<{ view: { title?: { text?: string } } }>(
      `SELECT view FROM aaelink.app_views WHERE id = $1`, [viewId]
    )
    expect(rows[0]?.view?.title?.text).not.toBe('pwned')
  })

  it('rejects a non-owner push onto another bot/user root modal (IDOR fix)', async () => {
    // victim opens a root modal directly in DB
    const victim = await createTestUser(ctx.pool, { role: 'employee' })
    userIds.push(victim.id)
    const victimBotId = await mkBot(victim.id)

    const rootId = `V${(await import('crypto')).randomUUID().replace(/-/g, '')}`
    const now = Date.now()
    await ctx.pool.query(
      `INSERT INTO aaelink.app_views
         (id, bot_id, app_id, user_id, channel_id, workspace_id, type, root_view_id,
          parent_view_id, external_id, view, state, hash, created_at, updated_at)
       VALUES ($1,$2,NULL,$3,NULL,NULL,'modal',$1,NULL,NULL,$4,'{"values":{}}',$5,$6,$6)`,
      [rootId, victimBotId, victim.id, JSON.stringify(goodView()), `${now}.abcdef`, now]
    )

    // attacker tries to push onto victim's root using a fresh trigger for attacker
    const attackerBotId = await mkBot(owner.id)
    const triggerId = await mintViewTrigger(ctx.pool, { botId: attackerBotId, userId: owner.id })
    const res = await POST(asRequest('POST', '/api/views', {
      cookie: owner.sessionCookie,
      body: {
        action: 'push',
        bot_id: attackerBotId,
        trigger_id: triggerId,
        view_id: rootId,
        view: goodView(),
      },
    }))
    expect(res.status).toBe(404)
  })
})
