/**
 * Integration tests for D12 file public links + sharing policy.
 *
 * Exercises lib/files/publicLinks.ts against a live Postgres. Routes
 * (files/[id]/public-link, files/public/[token], admin/file-sharing-policy) are
 * thin wrappers.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import {
  createPublicLink,
  resolvePublicLink,
  revokePublicLinks,
  getFileSharingPolicy,
  setFileSharingPolicy,
} from '@/lib/files/publicLinks'

let ctx: TestContext
let owner: TestUser
let other: TestUser
const userIds: string[] = []
const wsIds: string[] = []
const chIds: string[] = []
const msgIds: string[] = []
const fileIds: string[] = []

async function mkFile(): Promise<string> {
  const ws = `ws-${randomUUID().slice(0, 12)}`
  await ctx.pool.query(
    `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system) VALUES ($1,$1,$2,$3,$4,false)`,
    [ws, `WS ${ws.slice(-6)}`, owner.id, Date.now()]
  )
  wsIds.push(ws)
  const ch = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, created_at) VALUES ($1,$2,$3,$3,'O',$4)`,
    [ch, ws, `ch-${ch.slice(0, 8)}`, Date.now()]
  )
  chIds.push(ch)
  const msg = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at) VALUES ($1,$2,$3,'f','',$4,$4)`,
    [msg, ch, owner.id, Date.now()]
  )
  msgIds.push(msg)
  const file = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.file_attachments (id, message_id, channel_id, user_id, filename, content_type, size, storage_key, created_at)
     VALUES ($1,$2,$3,$4,'doc.pdf','application/pdf',1234,$5,$6)`,
    [file, msg, ch, owner.id, `s3://bucket/${file}`, Date.now()]
  )
  fileIds.push(file)
  return file
}

beforeAll(async () => {
  ctx = await createTestContext()
  owner = await createTestUser(ctx.pool, { role: 'employee' })
  other = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(owner.id, other.id)
})

afterAll(async () => {
  await setFileSharingPolicy(ctx.pool, { public_links_enabled: true }) // restore default
  if (fileIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.file_public_links WHERE file_id = ANY($1)`, [fileIds])
    await ctx.pool.query(`DELETE FROM aaelink.file_attachments WHERE id = ANY($1)`, [fileIds])
  }
  if (msgIds.length) await ctx.pool.query(`DELETE FROM aaelink.messages WHERE id = ANY($1)`, [msgIds])
  if (chIds.length) await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = ANY($1)`, [chIds])
  if (wsIds.length) await ctx.pool.query(`DELETE FROM aaelink.workspaces WHERE id = ANY($1)`, [wsIds])
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('createPublicLink', () => {
  it('rejects unknown files and non-uploaders', async () => {
    expect(await createPublicLink(ctx.pool, owner.id, 'nope')).toEqual({ ok: false, code: 'not_found' })
    const file = await mkFile()
    expect(await createPublicLink(ctx.pool, other.id, file)).toEqual({ ok: false, code: 'forbidden' })
  })

  it('mints a token for the uploader and reuses it on re-create', async () => {
    const file = await mkFile()
    const a = await createPublicLink(ctx.pool, owner.id, file)
    const b = await createPublicLink(ctx.pool, owner.id, file)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) expect(a.token).toBe(b.token) // reused
  })

  it('is blocked when external sharing is disabled', async () => {
    const file = await mkFile()
    await setFileSharingPolicy(ctx.pool, { public_links_enabled: false })
    expect(await createPublicLink(ctx.pool, owner.id, file)).toEqual({ ok: false, code: 'sharing_disabled' })
    await setFileSharingPolicy(ctx.pool, { public_links_enabled: true })
  })
})

describe('resolvePublicLink', () => {
  it('resolves an active link, and stops after revoke or when sharing is off', async () => {
    const file = await mkFile()
    const created = await createPublicLink(ctx.pool, owner.id, file)
    if (!created.ok) throw new Error('create failed')

    const resolved = await resolvePublicLink(ctx.pool, created.token)
    expect(resolved?.file_id).toBe(file)
    expect(resolved?.filename).toBe('doc.pdf')

    expect(await resolvePublicLink(ctx.pool, 'flink_nope')).toBeNull()

    // Policy off hides it.
    await setFileSharingPolicy(ctx.pool, { public_links_enabled: false })
    expect(await resolvePublicLink(ctx.pool, created.token)).toBeNull()
    await setFileSharingPolicy(ctx.pool, { public_links_enabled: true })

    // Revoke kills it.
    expect(await revokePublicLinks(ctx.pool, owner.id, file)).toEqual({ ok: true, fileId: file })
    expect(await resolvePublicLink(ctx.pool, created.token)).toBeNull()
  })
})

describe('revokePublicLinks', () => {
  it('rejects non-uploaders', async () => {
    const file = await mkFile()
    await createPublicLink(ctx.pool, owner.id, file)
    expect(await revokePublicLinks(ctx.pool, other.id, file)).toEqual({ ok: false, code: 'forbidden' })
  })
})

describe('file sharing policy', () => {
  it('defaults to enabled and persists a toggle', async () => {
    await ctx.pool.query(`DELETE FROM aaelink.system_config WHERE key = 'file_sharing_policy'`)
    expect((await getFileSharingPolicy(ctx.pool)).public_links_enabled).toBe(true)
    const updated = await setFileSharingPolicy(ctx.pool, { public_links_enabled: false })
    expect(updated.public_links_enabled).toBe(false)
    expect((await getFileSharingPolicy(ctx.pool)).public_links_enabled).toBe(false)
    await setFileSharingPolicy(ctx.pool, { public_links_enabled: true })
  })
})
