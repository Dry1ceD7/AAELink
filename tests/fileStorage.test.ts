/**
 * Unit tests for lib/files/storage.ts — the file storage backend abstraction.
 *
 * These cover the local-disk fallback path that is exercised when S3 is NOT
 * configured (S3_ENDPOINT unset). This must stay green in dev/CI with no S3 env,
 * which is the contract the rest of the test suite relies on. The S3 path is not
 * unit-tested here (it requires a live MinIO/S3 and is integration territory).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { storeFileBytes, readFileBytes, removeFileObject, UPLOAD_DIR } from '@/lib/files/storage'

let savedEndpoint: string | undefined

beforeEach(() => {
  // Force the local backend for these tests.
  savedEndpoint = process.env.S3_ENDPOINT
  delete process.env.S3_ENDPOINT
})

afterEach(() => {
  if (savedEndpoint === undefined) delete process.env.S3_ENDPOINT
  else process.env.S3_ENDPOINT = savedEndpoint
})

describe('storage — local backend (S3 unconfigured)', () => {
  it('stores to disk and reports backend=local', async () => {
    const id = randomUUID()
    const localKey = `${id}.txt`
    const body = Buffer.from('storage-fallback-bytes')
    const out = await storeFileBytes({
      fileId: id,
      filename: 'note.txt',
      contentType: 'text/plain',
      body,
      localKey,
    })
    expect(out.backend).toBe('local')
    expect(out.storageKey).toBe(localKey)
    expect(fs.existsSync(path.join(UPLOAD_DIR, localKey))).toBe(true)
    await removeFileObject(localKey, 'local')
  })

  it('round-trips bytes through readFileBytes', async () => {
    const id = randomUUID()
    const localKey = `${id}.bin`
    const body = Buffer.from([1, 2, 3, 4, 250, 251])
    await storeFileBytes({ fileId: id, filename: 'b.bin', contentType: 'application/octet-stream', body, localKey })
    const read = await readFileBytes(localKey, 'local')
    expect(read).not.toBeNull()
    expect(Buffer.compare(read!, body)).toBe(0)
    await removeFileObject(localKey, 'local')
  })

  it('readFileBytes returns null for a missing local object', async () => {
    const read = await readFileBytes(`missing-${randomUUID()}.txt`, 'local')
    expect(read).toBeNull()
  })

  it('resolves legacy/unknown backend as local disk', async () => {
    const id = randomUUID()
    const localKey = `${id}.txt`
    const body = Buffer.from('legacy-row')
    await storeFileBytes({ fileId: id, filename: 'l.txt', contentType: 'text/plain', body, localKey })
    // backend null (pre-Stage-B rows) → disk.
    const read = await readFileBytes(localKey, null)
    expect(read).not.toBeNull()
    expect(read!.toString()).toBe('legacy-row')
    await removeFileObject(localKey, null)
  })

  it('removeFileObject deletes the local file and is idempotent', async () => {
    const id = randomUUID()
    const localKey = `${id}.txt`
    await storeFileBytes({ fileId: id, filename: 'd.txt', contentType: 'text/plain', body: Buffer.from('x'), localKey })
    const full = path.join(UPLOAD_DIR, localKey)
    expect(fs.existsSync(full)).toBe(true)

    expect(await removeFileObject(localKey, 'local')).toBe(true)
    expect(fs.existsSync(full)).toBe(false)
    // Second remove on an absent file still resolves true (no throw).
    expect(await removeFileObject(localKey, 'local')).toBe(true)
  })

  it('readFileBytes returns null for s3 backend when S3 is unconfigured', async () => {
    // backend says s3 but no client is available → null, never a throw.
    const read = await readFileBytes('chat/x/y.txt', 's3')
    expect(read).toBeNull()
  })

  it('removeFileObject returns false for s3 backend when S3 is unconfigured', async () => {
    expect(await removeFileObject('chat/x/y.txt', 's3')).toBe(false)
  })

  it('UPLOAD_DIR is an absolute path', () => {
    expect(path.isAbsolute(UPLOAD_DIR)).toBe(true)
  })
})
