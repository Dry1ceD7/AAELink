/**
 * Integration + unit tests for D7 app manifest ingestion.
 *
 * validateManifest is tested directly; ingestManifest runs against a live
 * Postgres. The route (app/api/apps/manifest) is a thin session + workspace-
 * admin + audit wrapper.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import { validateManifest, ingestManifest, type AppManifest } from '@/lib/apps/appManifest'

let ctx: TestContext
let owner: TestUser
const userIds: string[] = []
const wsIds: string[] = []
const appIds: string[] = []
const botIds: string[] = []

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

beforeAll(async () => {
  ctx = await createTestContext()
  owner = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(owner.id)
})

afterAll(async () => {
  if (botIds.length) await ctx.pool.query(`DELETE FROM aaelink.bot_users WHERE id = ANY($1)`, [botIds])
  if (appIds.length) await ctx.pool.query(`DELETE FROM aaelink.apps WHERE id = ANY($1)`, [appIds])
  if (wsIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE workspace_id = ANY($1)`, [wsIds])
    await ctx.pool.query(`DELETE FROM aaelink.workspaces WHERE id = ANY($1)`, [wsIds])
  }
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('validateManifest', () => {
  it('accepts a minimal valid manifest', () => {
    expect(validateManifest({ name: 'My App' })).toBeNull()
  })
  it('rejects missing name and malformed fields', () => {
    expect(validateManifest({} as AppManifest)?.field).toBe('name')
    expect(validateManifest({ name: 'x', scopes: ['ok', 1 as unknown as string] })?.field).toBe('scopes')
    expect(validateManifest({ name: 'x', redirect_urls: 5 as unknown as string[] })?.field).toBe('redirect_urls')
    expect(validateManifest({ name: 'x', bot: 'no' as unknown as AppManifest['bot'] })?.field).toBe('bot')
  })
})

describe('ingestManifest', () => {
  it('returns invalid_manifest for a bad manifest', async () => {
    const ws = await mkWorkspace()
    const res = await ingestManifest(ctx.pool, { workspaceId: ws, createdBy: owner.id, manifest: {} as AppManifest })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.detail.field).toBe('name')
  })

  it('creates an app with no bot', async () => {
    const ws = await mkWorkspace()
    const res = await ingestManifest(ctx.pool, {
      workspaceId: ws, createdBy: owner.id,
      manifest: { name: 'Plain App', description: 'no bot' },
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      appIds.push(res.app.app_id)
      expect(res.app.bot_id).toBeNull()
      expect(res.app.client_id).toBeNull()
      const { rows } = await ctx.pool.query(`SELECT name FROM aaelink.apps WHERE id = $1`, [res.app.app_id])
      expect(rows[0]?.name).toBe('Plain App')
    }
  })

  it('creates an app + bot with scopes and credentials', async () => {
    const ws = await mkWorkspace()
    const res = await ingestManifest(ctx.pool, {
      workspaceId: ws, createdBy: owner.id,
      manifest: {
        name: 'Bot App',
        bot: { name: 'Helper' },
        scopes: ['chat:write', 'channels:read'],
        redirect_urls: ['https://app.test/cb'],
      },
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      appIds.push(res.app.app_id)
      botIds.push(res.app.bot_id!)
      expect(res.app.bot_id).toBeTruthy()
      expect(res.app.client_id).toMatch(/^client_/)
      expect(res.app.api_token).toMatch(/^xoxb-/)
      expect(res.app.scopes).toEqual(['chat:write', 'channels:read'])

      const { rows } = await ctx.pool.query<{ name: string; scopes: string[]; status: string }>(
        `SELECT name, scopes, status FROM aaelink.bot_users WHERE id = $1`, [res.app.bot_id]
      )
      expect(rows[0]?.name).toBe('Helper')
      expect(rows[0]?.scopes).toEqual(['chat:write', 'channels:read'])
      expect(rows[0]?.status).toBe('active')
    }
  })
})
