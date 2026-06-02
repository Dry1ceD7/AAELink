/**
 * Deliver stage — post the rendered document to the chosen channel as
 * an AAELink message with a file attachment record.
 */

import { randomUUID } from 'crypto'
import type { Pool } from 'pg'
import type { StageResult } from './types'
import { log } from '@/lib/infra/log'

export interface DeliverInput {
  pool: Pool
  workspace_id: string
  channel_id: string | null
  /** When set, also drop a comment on the ticket linking back to the assembly. */
  ticket_id?: string | null
  assembly_id: string
  bucket_key: string
  size_bytes: number
  filename: string
  posted_by: string
}

export interface DeliverOutput {
  message_id: string | null
  channel_id: string | null
  ticket_comment_id?: string | null
}

export async function runDeliver(input: DeliverInput): Promise<StageResult<DeliverOutput>> {
  // file_attachments row (mirrors existing pattern in lib/migrate.ts)
  const attachmentId = randomUUID()
  const now = Date.now()
  try {
    await input.pool.query(
      `INSERT INTO aaelink.file_attachments
        (id, workspace_id, uploader_id, bucket_key, filename, content_type, size_bytes, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO NOTHING`,
      [attachmentId, input.workspace_id, input.posted_by, input.bucket_key, input.filename, 'application/pdf', input.size_bytes, now]
    )
  } catch { /* table shape may differ across environments — non-fatal */ }

  // Best-effort ticket comment — non-fatal; we still try the channel post below.
  let ticketCommentId: string | null = null
  if (input.ticket_id) {
    try {
      ticketCommentId = randomUUID()
      const downloadPath = `/api/documents/assemblies/${encodeURIComponent(input.assembly_id)}/download`
      await input.pool.query(
        `INSERT INTO aaelink.ticket_comments
           (id, ticket_id, author_id, body, is_internal, created_at, updated_at)
         VALUES ($1,$2,$3,$4,false,$5,$5)`,
        [
          ticketCommentId,
          input.ticket_id,
          input.posted_by,
          `📄 Document ready: [${input.filename}](${downloadPath}) (${(input.size_bytes / 1024).toFixed(1)} KB)`,
          now,
        ]
      )
      await input.pool.query(`UPDATE aaelink.tickets SET updated_at = $1 WHERE id = $2`, [now, input.ticket_id])
    } catch (err: unknown) {
      log.error('puzzleBox ticket comment failed', {
        name: 'puzzleBox.deliver',
        ticket_id: input.ticket_id,
        error: err instanceof Error ? err.message : String(err),
      })
      ticketCommentId = null
    }
  }

  if (!input.channel_id) {
    return { ok: true, value: { message_id: null, channel_id: null, ticket_comment_id: ticketCommentId } }
  }

  const messageId = randomUUID()
  try {
    await input.pool.query(
      `INSERT INTO aaelink.messages
         (id, channel_id, user_id, body, created_at, updated_at, attachments)
       VALUES ($1,$2,$3,$4,$5,$5,$6)`,
      [
        messageId,
        input.channel_id,
        input.posted_by,
        `📄 Document ready: ${input.filename}`,
        now,
        JSON.stringify([{ id: attachmentId, key: input.bucket_key, name: input.filename, type: 'application/pdf', size: input.size_bytes }]),
      ]
    )
    return { ok: true, value: { message_id: messageId, channel_id: input.channel_id, ticket_comment_id: ticketCommentId } }
  } catch (e) {
    return { ok: false, code: 'delivery_failed', message: e instanceof Error ? e.message : String(e), recoverable: true }
  }
}
