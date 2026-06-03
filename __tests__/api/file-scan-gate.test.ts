/**
 * Integration tests for D12 virus-scan access gate.
 *
 * Exercises lib/files/scanGate.ts against a live Postgres. The gate is wired into
 * the file download route and public-link resolution.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import {
  getScanVerdict,
  recordScanResult,
  getScanPolicy,
  setScanPolicy,
  verdictAllowsAccess,
  isFileAccessAllowed,
  DEFAULT_SCAN_POLICY,
} from '@/lib/files/scanGate'

let ctx: TestContext
let owner: TestUser
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
     VALUES ($1,$2,$3,$4,'f.bin','application/octet-stream',1,$5,$6)`,
    [file, msg, ch, owner.id, `s3://b/${file}`, Date.now()]
  )
  fileIds.push(file)
  return file
}

beforeAll(async () => {
  ctx = await createTestContext()
  owner = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(owner.id)
})

afterAll(async () => {
  await setScanPolicy(ctx.pool, { ...DEFAULT_SCAN_POLICY })
  if (fileIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.file_scans WHERE file_id = ANY($1)`, [fileIds])
    await ctx.pool.query(`DELETE FROM aaelink.file_attachments WHERE id = ANY($1)`, [fileIds])
  }
  if (msgIds.length) await ctx.pool.query(`DELETE FROM aaelink.messages WHERE id = ANY($1)`, [msgIds])
  if (chIds.length) await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = ANY($1)`, [chIds])
  if (wsIds.length) await ctx.pool.query(`DELETE FROM aaelink.workspaces WHERE id = ANY($1)`, [wsIds])
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('verdictAllowsAccess (pure)', () => {
  it('blocks infected always; clean ok; pending/unscanned per policy', () => {
    const lax = { block_infected: true, block_unscanned: false }
    const strict = { block_infected: true, block_unscanned: true }
    expect(verdictAllowsAccess('infected', lax)).toBe(false)
    expect(verdictAllowsAccess('clean', lax)).toBe(true)
    expect(verdictAllowsAccess('pending', lax)).toBe(true)
    expect(verdictAllowsAccess('unscanned', lax)).toBe(true)
    expect(verdictAllowsAccess('unscanned', strict)).toBe(false)
    expect(verdictAllowsAccess('pending', strict)).toBe(false)
  })
})

describe('getScanVerdict', () => {
  it('reports unscanned, then the latest recorded result', async () => {
    const file = await mkFile()
    expect(await getScanVerdict(ctx.pool, file)).toBe('unscanned')
    await recordScanResult(ctx.pool, { fileId: file, result: 'clean' }, 1000)
    expect(await getScanVerdict(ctx.pool, file)).toBe('clean')
    await recordScanResult(ctx.pool, { fileId: file, result: 'infected', threatName: 'EICAR' }, 2000)
    expect(await getScanVerdict(ctx.pool, file)).toBe('infected') // latest wins
  })
})

describe('isFileAccessAllowed', () => {
  it('blocks infected, allows clean, and honors strict policy for unscanned', async () => {
    const infected = await mkFile()
    await recordScanResult(ctx.pool, { fileId: infected, result: 'infected', threatName: 'X' })
    expect(await isFileAccessAllowed(ctx.pool, infected)).toBe(false)

    const clean = await mkFile()
    await recordScanResult(ctx.pool, { fileId: clean, result: 'clean' })
    expect(await isFileAccessAllowed(ctx.pool, clean)).toBe(true)

    const fresh = await mkFile() // unscanned
    expect(await isFileAccessAllowed(ctx.pool, fresh)).toBe(true) // default lax

    await setScanPolicy(ctx.pool, { block_unscanned: true })
    expect(await isFileAccessAllowed(ctx.pool, fresh)).toBe(false)   // strict blocks unscanned
    expect(await isFileAccessAllowed(ctx.pool, clean)).toBe(true)    // clean still ok
    expect(await isFileAccessAllowed(ctx.pool, infected)).toBe(false)
    await setScanPolicy(ctx.pool, { block_unscanned: false })
  })
})

describe('scan policy', () => {
  it('keeps block_infected forced true even if patched false', async () => {
    const p = await setScanPolicy(ctx.pool, { block_infected: false } as never)
    expect(p.block_infected).toBe(true)
    expect((await getScanPolicy(ctx.pool)).block_infected).toBe(true)
  })
})
