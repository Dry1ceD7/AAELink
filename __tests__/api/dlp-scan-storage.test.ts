/**
 * Integration test: runDlpScan resolves file content via the storage
 * abstraction (lib/files/storage.readFileBytes), not a raw local-disk read.
 *
 * Regression for the defect where the DLP scan read
 * `fs.readFileSync(UPLOAD_DIR/<storage_key>)` and ignored storage_backend, so an
 * S3-backed file scanned against EMPTY content — a silent compliance bypass.
 *
 * A local-backend file containing a secret triggers a violation (content was
 * resolved through the abstraction). S3 is not required by this suite.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import { runDlpScan } from '@/lib/enterprise/dlpScanJob'
import { UPLOAD_DIR } from '@/lib/files/storage'

let ctx: TestContext
let owner: TestUser
const userIds: string[] = []
const fileIds: string[] = []
const ruleIds: string[] = []
const localKeys: string[] = []
const SECRET = `dlp-secret-${randomUUID().slice(0, 8)}`

async function mkRule(): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.dlp_rules (id, name, type, pattern, action, severity, priority, is_active, created_at)
     VALUES ($1, 'storage-test', 'keyword', $2, 'warn', 'medium', 5, true, $3)`,
    [id, SECRET, Date.now()]
  )
  ruleIds.push(id)
  return id
}

async function mkLocalFile(content: string): Promise<string> {
  const id = randomUUID()
  const localKey = `${id}.txt`
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  fs.writeFileSync(path.join(UPLOAD_DIR, localKey), Buffer.from(content))
  localKeys.push(localKey)
  await ctx.pool.query(
    `INSERT INTO aaelink.file_attachments
       (id, message_id, channel_id, user_id, filename, content_type, size, storage_key, storage_backend, created_at)
     VALUES ($1, NULL, NULL, $2, 'dlp.txt', 'text/plain', $3, $4, 'local', $5)`,
    [id, owner.id, content.length, localKey, Date.now()]
  )
  fileIds.push(id)
  return id
}

beforeAll(async () => {
  ctx = await createTestContext()
  owner = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(owner.id)
  await mkRule()
})

afterAll(async () => {
  for (const k of localKeys) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, k)) } catch { /* already gone */ }
  }
  if (fileIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.dlp_violations WHERE rule_id = ANY($1)`, [ruleIds])
    await ctx.pool.query(`DELETE FROM aaelink.file_attachments WHERE id = ANY($1)`, [fileIds])
  }
  if (ruleIds.length) await ctx.pool.query(`DELETE FROM aaelink.dlp_rules WHERE id = ANY($1)`, [ruleIds])
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('runDlpScan — storage-abstraction file content', () => {
  it('reads a local-backend file via the abstraction and flags the violation', async () => {
    const fileId = await mkLocalFile(`memo containing ${SECRET} inside`)
    const out = await runDlpScan(ctx.pool, { file_id: fileId, user_id: owner.id })
    expect(out.violations).toBeGreaterThan(0)
    expect(out.clean).toBe(false)
  })

  it('clean file with no match yields no violation', async () => {
    const fileId = await mkLocalFile('nothing sensitive here')
    const out = await runDlpScan(ctx.pool, { file_id: fileId, user_id: owner.id })
    expect(out.violations).toBe(0)
    expect(out.clean).toBe(true)
  })
})
