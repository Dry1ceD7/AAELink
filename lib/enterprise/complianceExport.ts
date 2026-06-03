/**
 * eDiscovery / compliance export artifact builder.
 *
 * Produces a JSON and/or CSV artifact for a range of messages (and the
 * matching audit_log entries) and returns the serialized bytes ready to be
 * stored in S3. The worker handler wires this to the ediscovery_exports row.
 *
 * Schema notes (verified against lib/infra/migrate.ts):
 *   - aaelink.messages(id, channel_id, user_id, body, root_id, created_at)
 *   - aaelink.audit_log(id, actor_id, action, resource_kind, resource_id, created_at)
 *   - aaelink.ediscovery_exports(scope_from, scope_to, format, download_key, ...)
 */
import type { Pool } from 'pg'

export interface ExportMessage {
  id: string
  channel_id: string
  user_id: string
  body: string
  root_id: string
  created_at: number
}

export interface ExportAudit {
  id: string
  actor_id: string
  action: string
  resource_kind: string
  resource_id: string
  created_at: number
}

export interface ExportArtifact {
  body: Buffer
  contentType: string
  extension: string
  messageCount: number
  auditCount: number
}

/** CSV-escape a single field (RFC 4180). */
export function csvField(v: unknown): string {
  const s = v == null ? '' : String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function messagesToCsv(messages: ExportMessage[]): string {
  const header = ['id', 'channel_id', 'user_id', 'root_id', 'created_at', 'body']
  const lines = [header.join(',')]
  for (const m of messages) {
    lines.push([
      csvField(m.id), csvField(m.channel_id), csvField(m.user_id),
      csvField(m.root_id), csvField(m.created_at), csvField(m.body),
    ].join(','))
  }
  return lines.join('\r\n')
}

/** Build the export artifact for the requested format. */
export function buildArtifact(
  format: string,
  messages: ExportMessage[],
  audit: ExportAudit[]
): ExportArtifact {
  if (format === 'csv') {
    return {
      body: Buffer.from(messagesToCsv(messages), 'utf8'),
      contentType: 'text/csv',
      extension: 'csv',
      messageCount: messages.length,
      auditCount: audit.length,
    }
  }
  const payload = {
    generated_at: Date.now(),
    message_count: messages.length,
    audit_count: audit.length,
    messages,
    audit_log: audit,
  }
  return {
    body: Buffer.from(JSON.stringify(payload, null, 2), 'utf8'),
    contentType: 'application/json',
    extension: 'json',
    messageCount: messages.length,
    auditCount: audit.length,
  }
}

/** Load messages within [from, to] (ms). to=0 means open-ended. */
export async function loadExportMessages(
  pool: Pool, from: number, to: number, channelIds: string[]
): Promise<ExportMessage[]> {
  const params: unknown[] = [from]
  let where = `WHERE created_at >= $1`
  if (to > 0) { params.push(to); where += ` AND created_at <= $${params.length}` }
  if (channelIds.length > 0) {
    params.push(channelIds)
    where += ` AND channel_id = ANY($${params.length}::text[])`
  }
  const { rows } = await pool.query<ExportMessage>(
    `SELECT id, channel_id, user_id, body, root_id, created_at
       FROM aaelink.messages ${where} ORDER BY created_at ASC`,
    params
  )
  return rows.map((r) => ({ ...r, created_at: Number(r.created_at) }))
}

/** Load audit_log entries within [from, to] (ms). to=0 means open-ended. */
export async function loadExportAudit(
  pool: Pool, from: number, to: number
): Promise<ExportAudit[]> {
  const params: unknown[] = [from]
  let where = `WHERE created_at >= $1`
  if (to > 0) { params.push(to); where += ` AND created_at <= $${params.length}` }
  const { rows } = await pool.query<ExportAudit>(
    `SELECT id, actor_id, action, resource_kind, resource_id, created_at
       FROM aaelink.audit_log ${where} ORDER BY created_at ASC`,
    params
  )
  return rows.map((r) => ({ ...r, created_at: Number(r.created_at) }))
}
