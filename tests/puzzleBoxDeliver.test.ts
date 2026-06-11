/**
 * Puzzle Box — deliver stage behaviour.
 *
 * The deliver stage is the only pipeline step with side effects on rows
 * outside of `document_assemblies` / `document_pipeline_log`. We assert:
 *   1. With no channel and no ticket → records the file attachment, returns ok.
 *   2. With ticket_id set → also inserts a ticket comment + bumps ticket.updated_at.
 *   3. With channel_id set → posts a chat message with the file attached.
 *   4. A ticket comment failure does not prevent the channel message.
 *   5. A channel message failure surfaces a recoverable delivery_failed.
 */

import { describe, it, expect, vi } from 'vitest'
import { runDeliver } from '@/lib/documents/puzzleBox/deliver'

type QueryRecord = { sql: string; params: unknown[] }

function makePool(handler: (rec: QueryRecord) => unknown = () => ({ rows: [] })) {
  const calls: QueryRecord[] = []
  const pool = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const rec = { sql, params }
      calls.push(rec)
      return handler(rec)
    }),
  }
  return { pool: pool as unknown as Parameters<typeof runDeliver>[0]['pool'], calls }
}

const baseInput = {
  workspace_id: 'w1',
  channel_id: null,
  assembly_id: 'a1',
  bucket_key: 'workspaces/w1/documents/a1.pdf',
  size_bytes: 1024,
  filename: 'a1.pdf',
  posted_by: 'u1',
}

describe('runDeliver — no channel, no ticket', () => {
  it('writes the attachment and returns ok with null ids', async () => {
    const { pool, calls } = makePool()
    const out = await runDeliver({ pool, ...baseInput })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.value.message_id).toBeNull()
    expect(out.value.channel_id).toBeNull()
    expect(out.value.ticket_comment_id ?? null).toBeNull()
    expect(calls.some(c => /file_attachments/.test(c.sql))).toBe(true)
    expect(calls.some(c => /aaelink\.messages/.test(c.sql))).toBe(false)
  })
})

describe('runDeliver — with ticket_id', () => {
  it('inserts a ticket comment and bumps ticket.updated_at', async () => {
    const { pool, calls } = makePool()
    const out = await runDeliver({ pool, ...baseInput, ticket_id: 't1' })
    expect(out.ok).toBe(true)
    expect(calls.some(c => /ticket_comments/.test(c.sql))).toBe(true)
    expect(calls.some(c => /UPDATE aaelink\.tickets SET updated_at/.test(c.sql))).toBe(true)
  })

  it('returns ticket_comment_id when ticket-comment insert succeeds', async () => {
    const { pool } = makePool()
    const out = await runDeliver({ pool, ...baseInput, ticket_id: 't1' })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(typeof out.value.ticket_comment_id).toBe('string')
  })

  it('a ticket comment failure does not block the overall stage', async () => {
    const { pool } = makePool((rec) => {
      if (/ticket_comments/.test(rec.sql)) throw new Error('boom')
      return { rows: [] }
    })
    const out = await runDeliver({ pool, ...baseInput, ticket_id: 't1' })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.value.ticket_comment_id).toBeNull()
  })
})

describe('runDeliver — with channel_id', () => {
  it('posts a chat message with attachment metadata', async () => {
    const { pool, calls } = makePool()
    const out = await runDeliver({ pool, ...baseInput, channel_id: 'c1' })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.value.message_id).toBeTypeOf('string')
    expect(out.value.channel_id).toBe('c1')
    const msgInsert = calls.find(c => /INSERT INTO aaelink\.messages/.test(c.sql))
    expect(msgInsert).toBeTruthy()
    // Body argument should mention the filename
    const body = (msgInsert!.params[3] as string)
    expect(body).toContain(baseInput.filename)
  })

  it('surfaces a recoverable delivery_failed when the message insert throws', async () => {
    const { pool } = makePool((rec) => {
      if (/INSERT INTO aaelink\.messages/.test(rec.sql)) throw new Error('db down')
      return { rows: [] }
    })
    const out = await runDeliver({ pool, ...baseInput, channel_id: 'c1' })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.code).toBe('delivery_failed')
    expect(out.recoverable).toBe(true)
  })
})

describe('runDeliver — with both ticket_id and channel_id', () => {
  it('writes both targets', async () => {
    const { pool, calls } = makePool()
    const out = await runDeliver({ pool, ...baseInput, channel_id: 'c1', ticket_id: 't1' })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.value.ticket_comment_id).toBeTypeOf('string')
    expect(out.value.message_id).toBeTypeOf('string')
    expect(calls.some(c => /ticket_comments/.test(c.sql))).toBe(true)
    expect(calls.some(c => /INSERT INTO aaelink\.messages/.test(c.sql))).toBe(true)
  })
})
