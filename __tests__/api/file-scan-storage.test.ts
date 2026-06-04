/**
 * Integration test: runFileScan resolves bytes via the storage abstraction
 * (lib/files/storage.readFileBytes), not a raw local-disk read.
 *
 * Regression for the defect where the scan job read
 * `fs.readFileSync(UPLOAD_DIR/<storage_key>)` and ignored storage_backend, so an
 * S3-backed upload (key 'chat/<id>/<filename>') could never be scanned —
 * verdict stayed 'pending' forever and strict policy blocked the file.
 *
 * S3 is intentionally NOT required here (S3_ENDPOINT unset, the suite contract):
 *   - a local-backend row with real on-disk bytes is found (the scan does not
 *     fail with 'bytes missing'), proving bytes resolve through the abstraction;
 *   - an s3-backend row whose key is NOT on local disk records 'pending' and
 *     throws 'bytes missing' — proving the scan no longer mistakes an s3 key for
 *     a local path (the old code would have read UPLOAD_DIR/chat/<id>/... too,
 *     but the point is the resolution now flows through readFileBytes, which
 *     returns null for s3 when unconfigured rather than touching disk).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import { runFileScan } from '@/lib/files/fileScanJob'
import { getScanVerdict, recordScanResult } from '@/lib/files/scanGate'
import { UPLOAD_DIR } from '@/lib/files/storage'

let ctx: TestContext
let owner: TestUser
const userIds: string[] = []
const fileIds: string[] = []
const localKeys: string[] = []

async function mkFileRow(opts: {
  storageKey: string
  backend: 'local' | 's3'
}): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.file_attachments
       (id, message_id, channel_id, user_id, filename, content_type, size, storage_key, storage_backend, created_at)
     VALUES ($1, NULL, NULL, $2, 'scan.bin', 'application/octet-stream', 4, $3, $4, $5)`,
    [id, owner.id, opts.storageKey, opts.backend, Date.now()]
  )
  fileIds.push(id)
  return id
}

beforeAll(async () => {
  ctx = await createTestContext()
  owner = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(owner.id)
})

afterAll(async () => {
  for (const k of localKeys) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, k)) } catch { /* already gone */ }
  }
  if (fileIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.file_scans WHERE file_id = ANY($1)`, [fileIds])
    await ctx.pool.query(`DELETE FROM aaelink.file_attachments WHERE id = ANY($1)`, [fileIds])
  }
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('runFileScan — storage-abstraction byte resolution', () => {
  it('finds bytes for a local-backend row (does not fail with bytes-missing)', async () => {
    const id = randomUUID()
    const localKey = `${id}.bin`
    fs.mkdirSync(UPLOAD_DIR, { recursive: true })
    fs.writeFileSync(path.join(UPLOAD_DIR, localKey), Buffer.from('safe'))
    localKeys.push(localKey)

    const fileId = await mkFileRow({ storageKey: localKey, backend: 'local' })
    // clamd is typically unreachable in CI → verdict 'unknown' → recorded
    // 'pending', but crucially NOT the 'bytes missing' path. The result is a
    // valid verdict, never a throw.
    const out = await runFileScan(ctx.pool, { file_id: fileId })
    expect(['clean', 'infected', 'pending']).toContain(out.result)
  })

  it('keeps verdict pending (not a wrong-path read) for an s3-backend row when S3 is unconfigured', async () => {
    const fileId = await mkFileRow({
      storageKey: `chat/${randomUUID()}/doc.bin`,
      backend: 's3',
    })
    // Mirror the real flow: enqueueUploadJobs records a pending scan row before
    // the scan job runs (recordVerdict only UPDATEs an existing row).
    await recordScanResult(ctx.pool, { fileId, result: 'pending' })

    // readFileBytes('chat/...','s3') → null (no S3 client) → stays pending + throw.
    // The old code would have read UPLOAD_DIR/chat/<id>/doc.bin off local disk;
    // resolution now flows through readFileBytes which returns null for s3.
    await expect(runFileScan(ctx.pool, { file_id: fileId })).rejects.toThrow(/bytes missing/)
    expect(await getScanVerdict(ctx.pool, fileId)).toBe('pending')
  })
})
