/**
 * Canvas sections operating on content_blocks (Stage B unification).
 *
 * Before Stage B the sections route wrote a parallel aaelink.canvas_sections
 * table that the canvas GET never read (content_blocks was the read path) — a
 * write-only split-brain. Stage B makes a "section" simply a block in the
 * canvas's content_blocks array, identified by a stable `id` on the block. These
 * helpers manipulate that array (create / update / delete / reorder) with
 * optimistic concurrency: the caller passes the updated_at it last saw and we
 * reject (409 stale_canvas) if the row has moved on, so two editors don't clobber
 * each other.
 *
 * aaelink.canvas_sections is RETIRED from the write path (the table is left in
 * place for rollback / historical reads, but nothing writes it anymore). All
 * persistence goes through content_blocks on aaelink.canvases.
 *
 * Concurrency note: the load → mutate → conditional-write is guarded by a
 * `WHERE updated_at = $expected` on the UPDATE, so the check-and-set is atomic at
 * the row level (no lost update even under concurrent writers) — a mismatch
 * yields rowCount 0 which we surface as stale.
 */
import type { Pool } from 'pg'
import { randomUUID } from 'crypto'

export interface CanvasBlock {
  id: string
  type: string
  content?: string
  [k: string]: unknown
}

export type SectionOpResult =
  | { ok: true; blocks: CanvasBlock[]; updated_at: number; section_id?: string }
  | { ok: false; code: 'canvas_not_found' | 'stale_canvas' | 'section_not_found' | 'payload_too_large' | 'too_many_blocks' }

/**
 * Size caps for canvas/list JSONB payloads. A write-access holder (for a
 * channel_canvas, any channel reader) could otherwise POST multi-megabyte blobs
 * to bloat storage and slow every subsequent read (the whole array is loaded into
 * memory on each section op and GET). Mirrors the size-cap convention used by
 * file uploads. `checkBlocksPayload` returns an error code or null.
 */
export const MAX_BLOCKS_BYTES = 1_048_576 // 1 MiB serialized content_blocks
export const MAX_BLOCKS_COUNT = 5_000 // max blocks (sections) per canvas
export const MAX_SHARED_WITH = 1_000 // max shared_with grantees per canvas
export const MAX_LIST_VALUES_BYTES = 262_144 // 256 KiB serialized list item values

export type PayloadCapError = 'payload_too_large' | 'too_many_blocks'

/** Reject an oversized content_blocks payload before it is persisted. */
export function checkBlocksPayload(blocks: unknown[]): PayloadCapError | null {
  if (blocks.length > MAX_BLOCKS_COUNT) return 'too_many_blocks'
  if (Buffer.byteLength(JSON.stringify(blocks), 'utf8') > MAX_BLOCKS_BYTES) return 'payload_too_large'
  return null
}

/** Reject an oversized JSON payload (shared_with array, list item values) by byte size. */
export function checkJsonBytes(value: unknown, maxBytes: number): boolean {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8') <= maxBytes
}

/** Coerce a content_blocks column (native jsonb or string) into an array of blocks. */
export function parseBlocks(raw: unknown): CanvasBlock[] {
  let arr: unknown = raw
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw || '[]') } catch { return [] }
  }
  if (!Array.isArray(arr)) return []
  return arr.map((b) => {
    const block = (b && typeof b === 'object') ? (b as Record<string, unknown>) : { type: 'paragraph' }
    // Ensure every block has a stable id so sections are addressable.
    const id = typeof block.id === 'string' && block.id ? block.id : randomUUID()
    return { ...block, id, type: typeof block.type === 'string' ? block.type : 'paragraph' } as CanvasBlock
  })
}

function wordCount(blocks: CanvasBlock[]): number {
  return blocks.reduce((sum, b) => sum + String(b.content || '').split(/\s+/).filter(Boolean).length, 0)
}

/** Load a canvas's blocks + current updated_at (live rows only). */
async function loadBlocks(
  pool: Pool, canvasId: string
): Promise<{ blocks: CanvasBlock[]; updated_at: number } | null> {
  const { rows } = await pool.query<{ content_blocks: unknown; updated_at: string | number }>(
    `SELECT content_blocks, updated_at FROM aaelink.canvases WHERE id = $1 AND deleted_at = 0`,
    [canvasId]
  )
  if (!rows[0]) return null
  return { blocks: parseBlocks(rows[0].content_blocks), updated_at: Number(rows[0].updated_at || 0) }
}

/**
 * Persist a new blocks array with an optimistic-concurrency guard. Writes only
 * if the row's updated_at still equals `expectedUpdatedAt` (when provided). On a
 * mismatch the UPDATE affects 0 rows → stale_canvas. Returns the new updated_at.
 */
async function writeBlocks(
  pool: Pool, canvasId: string, blocks: CanvasBlock[], uid: string, expectedUpdatedAt?: number
): Promise<{ ok: true; updated_at: number } | { ok: false; code: 'stale_canvas' }> {
  const now = Date.now()
  const params: unknown[] = [JSON.stringify(blocks), wordCount(blocks), blocks.length, uid, now, canvasId]
  let guard = ''
  if (expectedUpdatedAt !== undefined) {
    params.push(expectedUpdatedAt)
    guard = ` AND updated_at = $${params.length}`
  }
  const { rowCount } = await pool.query(
    `UPDATE aaelink.canvases
        SET content_blocks = $1::jsonb, word_count = $2, block_count = $3,
            last_edited_by = $4, updated_at = $5
      WHERE id = $6 AND deleted_at = 0${guard}`,
    params
  )
  if (!rowCount) return { ok: false, code: 'stale_canvas' }
  return { ok: true, updated_at: now }
}

/** Append a new section (block) to the canvas. */
export async function createSection(
  pool: Pool, canvasId: string, uid: string,
  opts: { section_type?: string; title?: string; content?: string; position?: number; expected_updated_at?: number }
): Promise<SectionOpResult> {
  const loaded = await loadBlocks(pool, canvasId)
  if (!loaded) return { ok: false, code: 'canvas_not_found' }
  if (opts.expected_updated_at !== undefined && loaded.updated_at !== opts.expected_updated_at) {
    return { ok: false, code: 'stale_canvas' }
  }

  const block: CanvasBlock = {
    id: randomUUID(),
    type: opts.section_type || 'paragraph',
    content: opts.content || '',
    ...(opts.title ? { title: opts.title } : {}),
  }
  const blocks = loaded.blocks.slice()
  const pos = opts.position
  if (typeof pos === 'number' && pos >= 0 && pos < blocks.length) blocks.splice(pos, 0, block)
  else blocks.push(block)

  const cap = checkBlocksPayload(blocks)
  if (cap) return { ok: false, code: cap }

  const w = await writeBlocks(pool, canvasId, blocks, uid, opts.expected_updated_at ?? loaded.updated_at)
  if (!w.ok) return { ok: false, code: 'stale_canvas' }
  return { ok: true, blocks, updated_at: w.updated_at, section_id: block.id }
}

/** Update a section (block) by id. */
export async function updateSection(
  pool: Pool, canvasId: string, uid: string, sectionId: string,
  changes: { section_type?: string; title?: string; content?: string; expected_updated_at?: number }
): Promise<SectionOpResult> {
  const loaded = await loadBlocks(pool, canvasId)
  if (!loaded) return { ok: false, code: 'canvas_not_found' }
  if (changes.expected_updated_at !== undefined && loaded.updated_at !== changes.expected_updated_at) {
    return { ok: false, code: 'stale_canvas' }
  }
  const blocks = loaded.blocks.slice()
  const idx = blocks.findIndex((b) => b.id === sectionId)
  if (idx === -1) return { ok: false, code: 'section_not_found' }

  const next = { ...blocks[idx] }
  if (changes.section_type !== undefined) next.type = changes.section_type
  if (changes.title !== undefined) next.title = changes.title
  if (changes.content !== undefined) next.content = changes.content
  blocks[idx] = next

  const cap = checkBlocksPayload(blocks)
  if (cap) return { ok: false, code: cap }

  const w = await writeBlocks(pool, canvasId, blocks, uid, changes.expected_updated_at ?? loaded.updated_at)
  if (!w.ok) return { ok: false, code: 'stale_canvas' }
  return { ok: true, blocks, updated_at: w.updated_at, section_id: sectionId }
}

/** Delete a section (block) by id. */
export async function deleteSection(
  pool: Pool, canvasId: string, uid: string, sectionId: string, expectedUpdatedAt?: number
): Promise<SectionOpResult> {
  const loaded = await loadBlocks(pool, canvasId)
  if (!loaded) return { ok: false, code: 'canvas_not_found' }
  if (expectedUpdatedAt !== undefined && loaded.updated_at !== expectedUpdatedAt) {
    return { ok: false, code: 'stale_canvas' }
  }
  const blocks = loaded.blocks.filter((b) => b.id !== sectionId)
  if (blocks.length === loaded.blocks.length) return { ok: false, code: 'section_not_found' }

  const w = await writeBlocks(pool, canvasId, blocks, uid, expectedUpdatedAt ?? loaded.updated_at)
  if (!w.ok) return { ok: false, code: 'stale_canvas' }
  return { ok: true, blocks, updated_at: w.updated_at, section_id: sectionId }
}

/** Reorder sections to match `order` (a list of block ids). Unknown ids are ignored; omitted blocks keep their relative order at the end. */
export async function reorderSections(
  pool: Pool, canvasId: string, uid: string, order: string[], expectedUpdatedAt?: number
): Promise<SectionOpResult> {
  const loaded = await loadBlocks(pool, canvasId)
  if (!loaded) return { ok: false, code: 'canvas_not_found' }
  if (expectedUpdatedAt !== undefined && loaded.updated_at !== expectedUpdatedAt) {
    return { ok: false, code: 'stale_canvas' }
  }
  const byId = new Map(loaded.blocks.map((b) => [b.id, b]))
  const ordered: CanvasBlock[] = []
  for (const id of order) {
    const b = byId.get(id)
    if (b) { ordered.push(b); byId.delete(id) }
  }
  // Append any blocks not named in `order`, preserving their original order.
  for (const b of loaded.blocks) if (byId.has(b.id)) ordered.push(b)

  const w = await writeBlocks(pool, canvasId, ordered, uid, expectedUpdatedAt ?? loaded.updated_at)
  if (!w.ok) return { ok: false, code: 'stale_canvas' }
  return { ok: true, blocks: ordered, updated_at: w.updated_at }
}
