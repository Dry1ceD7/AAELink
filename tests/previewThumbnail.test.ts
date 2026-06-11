/**
 * Unit tests for lib/files/previewThumbnail.ts — serveThumbnail().
 *
 * This is the highest-risk new code in the thumbnail stream: it is the access
 * gate for derived thumbnail bytes. A bug here would leak another user's image
 * thumbnail or serve scan-blocked content, so every branch is exercised here
 * with everything external stubbed:
 *   - the channel-read ACL (userCanReadChannel),
 *   - the D12 virus-scan gate (isFileAccessAllowed),
 *   - the storage abstraction (readFileBytes).
 * buildServeHeaders is pure and runs for real so the success-path headers
 * (image/webp, private cache) are asserted against the actual builder.
 *
 * Asserted behavior:
 *   - missing / soft-deleted row → 404
 *   - non-uploader with no channel access → 403
 *   - non-uploader on an unattached (no channel) file → 403
 *   - uploader → 200 (own file)
 *   - non-uploader WITH channel read access → 200
 *   - scan gate blocks → 403
 *   - empty thumbnail_key → 404
 *   - thumbnail_key set but bytes missing → 404
 *   - success → image/webp + Cache-Control private, max-age=86400
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Pool } from 'pg'

// Mocks must be declared before the SUT import so vitest hoists them.
vi.mock('@/lib/enterprise/collab-access', () => ({
  userCanReadChannel: vi.fn(),
}))
vi.mock('@/lib/files/scanGate', () => ({
  isFileAccessAllowed: vi.fn(),
}))
vi.mock('@/lib/files/storage', () => ({
  readFileBytes: vi.fn(),
}))

import { serveThumbnail } from '@/lib/files/previewThumbnail'
import { userCanReadChannel } from '@/lib/enterprise/collab-access'
import { isFileAccessAllowed } from '@/lib/files/scanGate'
import { readFileBytes } from '@/lib/files/storage'

type AttRow = {
  storage_backend: string | null
  thumbnail_key: string | null
  user_id: string
  channel_id: string | null
  deleted_at: string
}

/** Fake pool: scripts the single attachment SELECT serveThumbnail issues. */
function makePool(attachment: AttRow | null) {
  const query = vi.fn(async () => ({
    rowCount: attachment ? 1 : 0,
    rows: attachment ? [attachment] : [],
  }))
  return { query } as unknown as Pool
}

function attRow(overrides: Partial<AttRow> = {}): AttRow {
  return {
    storage_backend: 'local',
    thumbnail_key: 'abc.thumb.webp',
    user_id: 'owner',
    channel_id: null,
    deleted_at: '0',
    ...overrides,
  }
}

const okAcl = () => (userCanReadChannel as ReturnType<typeof vi.fn>).mockResolvedValue(true)
const okScan = () => (isFileAccessAllowed as ReturnType<typeof vi.fn>).mockResolvedValue(true)
const okBytes = () => (readFileBytes as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from('webp-bytes'))

beforeEach(() => {
  vi.clearAllMocks()
  // Default everything to "allowed"; each test overrides what it negates.
  okAcl()
  okScan()
  okBytes()
})

async function bodyOf(res: Awaited<ReturnType<typeof serveThumbnail>>): Promise<{ error?: string }> {
  try {
    return (await res.json()) as { error?: string }
  } catch {
    return {}
  }
}

describe('serveThumbnail — not found', () => {
  it('404s when the row is missing', async () => {
    const res = await serveThumbnail(makePool(null), 'owner', 'gone')
    expect(res.status).toBe(404)
    expect((await bodyOf(res)).error).toBe('file_not_found')
  })

  it('404s a soft-deleted row', async () => {
    const res = await serveThumbnail(makePool(attRow({ deleted_at: '12345' })), 'owner', 'f')
    expect(res.status).toBe(404)
    expect((await bodyOf(res)).error).toBe('file_not_found')
  })
})

describe('serveThumbnail — access control', () => {
  it('403s a non-uploader with no channel access', async () => {
    ;(userCanReadChannel as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    const res = await serveThumbnail(makePool(attRow({ user_id: 'owner', channel_id: 'c1' })), 'intruder', 'f')
    expect(res.status).toBe(403)
    expect((await bodyOf(res)).error).toBe('forbidden')
  })

  it('403s a non-uploader on an unattached (private) file (no channel)', async () => {
    const res = await serveThumbnail(makePool(attRow({ user_id: 'owner', channel_id: null })), 'intruder', 'f')
    expect(res.status).toBe(403)
    expect((await bodyOf(res)).error).toBe('forbidden')
    // No channel → userCanReadChannel is never consulted; it is a hard private.
    expect(userCanReadChannel).not.toHaveBeenCalled()
  })

  it('serves the uploader their own file (200)', async () => {
    const res = await serveThumbnail(makePool(attRow({ user_id: 'owner' })), 'owner', 'f')
    expect(res.status).toBe(200)
    // Uploader bypasses the channel ACL entirely.
    expect(userCanReadChannel).not.toHaveBeenCalled()
  })

  it('serves a non-uploader WITH channel read access (200)', async () => {
    ;(userCanReadChannel as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    const res = await serveThumbnail(makePool(attRow({ user_id: 'owner', channel_id: 'c1' })), 'member', 'f')
    expect(res.status).toBe(200)
    expect(userCanReadChannel).toHaveBeenCalledWith(expect.anything(), 'member', 'c1')
  })
})

describe('serveThumbnail — scan gate', () => {
  it('403s when the virus-scan gate blocks the file', async () => {
    ;(isFileAccessAllowed as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    const res = await serveThumbnail(makePool(attRow({ user_id: 'owner' })), 'owner', 'f')
    expect(res.status).toBe(403)
    expect((await bodyOf(res)).error).toBe('file_blocked_by_scan')
    // Blocked before any bytes are read.
    expect(readFileBytes).not.toHaveBeenCalled()
  })
})

describe('serveThumbnail — thumbnail resolution', () => {
  it('404s when thumbnail_key is empty (no thumbnail generated)', async () => {
    const res = await serveThumbnail(makePool(attRow({ user_id: 'owner', thumbnail_key: '' })), 'owner', 'f')
    expect(res.status).toBe(404)
    expect((await bodyOf(res)).error).toBe('thumbnail_not_found')
    expect(readFileBytes).not.toHaveBeenCalled()
  })

  it('404s when thumbnail_key is null', async () => {
    const res = await serveThumbnail(makePool(attRow({ user_id: 'owner', thumbnail_key: null })), 'owner', 'f')
    expect(res.status).toBe(404)
    expect((await bodyOf(res)).error).toBe('thumbnail_not_found')
  })

  it('404s when the thumbnail bytes are missing on the backend', async () => {
    ;(readFileBytes as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await serveThumbnail(makePool(attRow({ user_id: 'owner' })), 'owner', 'f')
    expect(res.status).toBe(404)
    expect((await bodyOf(res)).error).toBe('thumbnail_missing')
  })

  it('reads bytes via the row\'s recorded backend', async () => {
    await serveThumbnail(makePool(attRow({ user_id: 'owner', thumbnail_key: 'k.webp', storage_backend: 's3' })), 'owner', 'f')
    expect(readFileBytes).toHaveBeenCalledWith('k.webp', 's3')
  })
})

describe('serveThumbnail — success headers', () => {
  it('serves image/webp with a private, cacheable disposition (200)', async () => {
    const res = await serveThumbnail(makePool(attRow({ user_id: 'owner' })), 'owner', 'f')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/webp')
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=86400')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Content-Disposition')).toContain('inline')
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.toString()).toBe('webp-bytes')
  })
})
