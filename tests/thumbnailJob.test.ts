/**
 * Unit tests for lib/files/thumbnailJob.ts — the file_thumbnail worker handler.
 *
 * These cover the decision logic with everything external stubbed:
 *   - the storage abstraction (readFileBytes / storeDerivedBytes),
 *   - the pure dimension sniffer (extractImageMeta),
 *   - sharp (mocked module so no native dep is loaded in CI).
 * The pool is a SQL-capturing fake that scripts the attachment SELECT + the
 * media_policy SELECT, so nothing touches a real DB.
 *
 * Asserted behavior:
 *   - missing file_id throws
 *   - missing / soft-deleted row → no-op (no UPDATE)
 *   - unreadable bytes → no-op
 *   - non-image (extractImageMeta null) → no-op
 *   - image → width/height UPDATE; thumbnail generated + thumbnail_key UPDATE
 *   - policy generate_thumbnails=false → dims saved, NO thumbnail
 *   - sharp unavailable/failed → dims saved, NO thumbnail (not a job failure)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Pool } from 'pg'

// Mocks must be declared before the SUT import so vitest hoists them.
vi.mock('@/lib/files/storage', () => ({
  readFileBytes: vi.fn(),
  storeDerivedBytes: vi.fn(),
}))
vi.mock('@/lib/files/imageMeta', () => ({
  extractImageMeta: vi.fn(),
}))
// sharp is dynamically imported inside the job; control its behavior per-test.
const sharpToBuffer = vi.fn(async () => Buffer.from('webp-thumb-bytes'))
let sharpThrows = false
// Capture the options the job passes to the sharp() constructor (resource cap).
let lastSharpOpts: { limitInputPixels?: number; failOn?: string } | undefined
vi.mock('sharp', () => ({
  default: (_input: Buffer, opts?: { limitInputPixels?: number; failOn?: string }) => {
    lastSharpOpts = opts
    if (sharpThrows) throw new Error('sharp boom')
    const chain = {
      rotate: () => chain,
      resize: () => chain,
      webp: () => chain,
      toBuffer: sharpToBuffer,
    }
    return chain
  },
}))

import { runFileThumbnail } from '@/lib/files/thumbnailJob'
import { readFileBytes, storeDerivedBytes } from '@/lib/files/storage'
import { extractImageMeta } from '@/lib/files/imageMeta'

type Captured = { sql: string; params: unknown[] }
type AttRow = {
  storage_key: string
  storage_backend: string | null
  content_type: string
  deleted_at: string
}

/**
 * Fake pool: scripts the attachment SELECT and the media_policy SELECT, and
 * records every query so we can assert which UPDATEs fired.
 */
function makePool(opts: {
  attachment?: AttRow | null
  mediaPolicy?: Record<string, unknown> | null
}) {
  const calls: Captured[] = []
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params })
    if (sql.includes('FROM aaelink.file_attachments')) {
      const att = opts.attachment
      return { rowCount: att ? 1 : 0, rows: att ? [att] : [] }
    }
    if (sql.includes("system_config WHERE key = 'media_policy'")) {
      const v = opts.mediaPolicy
      return v
        ? { rowCount: 1, rows: [{ value: JSON.stringify(v) }] }
        : { rowCount: 0, rows: [] }
    }
    // UPDATEs
    return { rowCount: 1, rows: [] }
  })
  return { pool: { query } as unknown as Pool, calls }
}

function imageRow(overrides: Partial<AttRow> = {}): AttRow {
  return {
    storage_key: 'abc.png',
    storage_backend: 'local',
    content_type: 'image/png',
    deleted_at: '0',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  sharpThrows = false
  lastSharpOpts = undefined
  sharpToBuffer.mockResolvedValue(Buffer.from('webp-thumb-bytes'))
  ;(storeDerivedBytes as ReturnType<typeof vi.fn>).mockResolvedValue({
    backend: 'local',
    storageKey: 'abc.thumb.webp',
  })
})

const widthHeightUpdate = (c: Captured) =>
  /UPDATE aaelink\.file_attachments SET width = \$1, height = \$2/.test(c.sql)
const thumbKeyUpdate = (c: Captured) =>
  /UPDATE aaelink\.file_attachments SET thumbnail_key = \$1/.test(c.sql)

describe('runFileThumbnail — guards', () => {
  it('throws when file_id is missing', async () => {
    const { pool } = makePool({})
    await expect(runFileThumbnail(pool, {})).rejects.toThrow(/file_id required/)
  })

  it('no-ops on a missing row (no UPDATE)', async () => {
    const { pool, calls } = makePool({ attachment: null })
    const res = await runFileThumbnail(pool, { file_id: 'gone' })
    expect(res.dimensionsSaved).toBe(false)
    expect(res.thumbnailSaved).toBe(false)
    expect(calls.some(widthHeightUpdate)).toBe(false)
    expect(readFileBytes).not.toHaveBeenCalled()
  })

  it('no-ops on a soft-deleted row', async () => {
    const { pool, calls } = makePool({ attachment: imageRow({ deleted_at: '123' }) })
    const res = await runFileThumbnail(pool, { file_id: 'deleted' })
    expect(res.dimensionsSaved).toBe(false)
    expect(calls.some(widthHeightUpdate)).toBe(false)
  })

  it('no-ops when bytes are unreadable', async () => {
    const { pool, calls } = makePool({ attachment: imageRow() })
    ;(readFileBytes as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await runFileThumbnail(pool, { file_id: 'x' })
    expect(res.dimensionsSaved).toBe(false)
    expect(calls.some(widthHeightUpdate)).toBe(false)
  })

  it('no-ops on non-image content (extractImageMeta null)', async () => {
    const { pool, calls } = makePool({ attachment: imageRow({ content_type: 'application/pdf' }) })
    ;(readFileBytes as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from('%PDF-'))
    ;(extractImageMeta as ReturnType<typeof vi.fn>).mockReturnValue(null)
    const res = await runFileThumbnail(pool, { file_id: 'pdf' })
    expect(res.dimensionsSaved).toBe(false)
    expect(res.thumbnailSaved).toBe(false)
    expect(calls.some(widthHeightUpdate)).toBe(false)
    expect(storeDerivedBytes).not.toHaveBeenCalled()
  })
})

describe('runFileThumbnail — happy path', () => {
  it('saves dimensions and generates a thumbnail (default policy)', async () => {
    const { pool, calls } = makePool({ attachment: imageRow() })
    ;(readFileBytes as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from('PNGDATA'))
    ;(extractImageMeta as ReturnType<typeof vi.fn>).mockReturnValue({ width: 800, height: 600, orientation: 0 })

    const res = await runFileThumbnail(pool, { file_id: 'img' })

    expect(res).toEqual({ dimensionsSaved: true, width: 800, height: 600, thumbnailSaved: true })
    const dimCall = calls.find(widthHeightUpdate)
    expect(dimCall?.params).toEqual([800, 600, 'img'])
    // The derived thumbnail must be stored on the SAME backend the source row
    // records (here 'local'), not whatever getS3Client() currently returns —
    // serve + retention resolve the thumbnail via the row's storage_backend.
    expect(storeDerivedBytes).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'img', contentType: 'image/webp', backend: 'local' })
    )
    const thumbCall = calls.find(thumbKeyUpdate)
    expect(thumbCall?.params).toEqual(['abc.thumb.webp', 'img'])
  })

  it('forwards an s3 source backend to storeDerivedBytes', async () => {
    const { pool } = makePool({ attachment: imageRow({ storage_backend: 's3', storage_key: 'chat/img3/p.png' }) })
    ;(readFileBytes as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from('PNGDATA'))
    ;(extractImageMeta as ReturnType<typeof vi.fn>).mockReturnValue({ width: 800, height: 600, orientation: 0 })
    ;(storeDerivedBytes as ReturnType<typeof vi.fn>).mockResolvedValue({ backend: 's3', storageKey: 'thumb/img3.webp' })

    const res = await runFileThumbnail(pool, { file_id: 'img3' })
    expect(res.thumbnailSaved).toBe(true)
    expect(storeDerivedBytes).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'img3', backend: 's3' })
    )
  })

  it('passes the policy thumbnail size/quality through to sharp output', async () => {
    const { pool } = makePool({
      attachment: imageRow(),
      mediaPolicy: { generate_thumbnails: true, thumbnail_width: 200, thumbnail_height: 200, thumbnail_quality: 60 },
    })
    ;(readFileBytes as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from('PNGDATA'))
    ;(extractImageMeta as ReturnType<typeof vi.fn>).mockReturnValue({ width: 1024, height: 768, orientation: 0 })

    const res = await runFileThumbnail(pool, { file_id: 'img2' })
    expect(res.thumbnailSaved).toBe(true)
    expect(sharpToBuffer).toHaveBeenCalled()
  })

  it('constructs sharp with an explicit input-pixel cap + failOn (decompression-bomb guard)', async () => {
    const { pool } = makePool({ attachment: imageRow() })
    ;(readFileBytes as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from('PNGDATA'))
    ;(extractImageMeta as ReturnType<typeof vi.fn>).mockReturnValue({ width: 800, height: 600, orientation: 0 })

    await runFileThumbnail(pool, { file_id: 'capped' })
    // Policy — not sharp's library default — governs the decode bound.
    expect(lastSharpOpts?.limitInputPixels).toBe(50_000_000)
    expect(lastSharpOpts?.failOn).toBe('error')
  })
})

describe('runFileThumbnail — thumbnail skipped but dimensions kept', () => {
  it('skips the thumbnail when policy.generate_thumbnails is false', async () => {
    const { pool, calls } = makePool({
      attachment: imageRow(),
      mediaPolicy: { generate_thumbnails: false },
    })
    ;(readFileBytes as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from('PNGDATA'))
    ;(extractImageMeta as ReturnType<typeof vi.fn>).mockReturnValue({ width: 640, height: 480, orientation: 0 })

    const res = await runFileThumbnail(pool, { file_id: 'np' })
    expect(res.dimensionsSaved).toBe(true)
    expect(res.thumbnailSaved).toBe(false)
    expect(calls.some(widthHeightUpdate)).toBe(true)
    expect(storeDerivedBytes).not.toHaveBeenCalled()
    expect(calls.some(thumbKeyUpdate)).toBe(false)
  })

  it('keeps dimensions when sharp throws (encode failure)', async () => {
    const { pool, calls } = makePool({ attachment: imageRow() })
    ;(readFileBytes as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from('PNGDATA'))
    ;(extractImageMeta as ReturnType<typeof vi.fn>).mockReturnValue({ width: 100, height: 100, orientation: 0 })
    sharpThrows = true

    const res = await runFileThumbnail(pool, { file_id: 'broke' })
    expect(res.dimensionsSaved).toBe(true)
    expect(res.thumbnailSaved).toBe(false)
    expect(calls.some(widthHeightUpdate)).toBe(true)
    expect(storeDerivedBytes).not.toHaveBeenCalled()
  })

  it('keeps dimensions when sharp returns empty bytes', async () => {
    const { pool, calls } = makePool({ attachment: imageRow() })
    ;(readFileBytes as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from('PNGDATA'))
    ;(extractImageMeta as ReturnType<typeof vi.fn>).mockReturnValue({ width: 100, height: 100, orientation: 0 })
    sharpToBuffer.mockResolvedValue(Buffer.alloc(0))

    const res = await runFileThumbnail(pool, { file_id: 'empty' })
    expect(res.dimensionsSaved).toBe(true)
    expect(res.thumbnailSaved).toBe(false)
    expect(storeDerivedBytes).not.toHaveBeenCalled()
    expect(calls.some(thumbKeyUpdate)).toBe(false)
  })

  it('keeps dimensions but skips thumbnail when storeDerivedBytes returns null (s3 row, no client)', async () => {
    const { pool, calls } = makePool({ attachment: imageRow({ storage_backend: 's3', storage_key: 'chat/x/p.png' }) })
    ;(readFileBytes as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from('PNGDATA'))
    ;(extractImageMeta as ReturnType<typeof vi.fn>).mockReturnValue({ width: 100, height: 100, orientation: 0 })
    // Source row says 's3' but no S3 client → storeDerivedBytes can't write → null.
    ;(storeDerivedBytes as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    const res = await runFileThumbnail(pool, { file_id: 's3noclient' })
    expect(res.dimensionsSaved).toBe(true)
    expect(res.thumbnailSaved).toBe(false)
    expect(calls.some(widthHeightUpdate)).toBe(true)
    expect(calls.some(thumbKeyUpdate)).toBe(false)
  })
})
