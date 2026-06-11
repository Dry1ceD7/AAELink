/**
 * compliance_export (eDiscovery) job orchestration.
 *
 * Loads the ediscovery_exports row, gathers the in-range messages + audit
 * entries, serializes the artifact (JSON/CSV), uploads it to S3, then updates
 * the export row with the download key, counts, size and 'completed' status.
 */
import type { Pool } from 'pg'
import { getS3Client, getBucket, putObjectBytes } from '@/lib/infra/s3'
import {
  buildArtifact, loadExportMessages, loadExportAudit,
} from './complianceExport'
import { writeAuditLog } from './auditLog'

export interface ExportJobResult {
  exportId: string
  downloadKey: string
  messageCount: number
  sizeBytes: number
}

interface ExportRow {
  id: string; format: string; scope: unknown
  scope_from: string | number; scope_to: string | number
}

export async function runComplianceExport(
  pool: Pool, payload: { export_id?: string }
): Promise<ExportJobResult> {
  const exportId = String(payload.export_id || '').trim()
  if (!exportId) throw new Error('compliance_export: export_id required')

  const { rows } = await pool.query<ExportRow>(
    `SELECT id, format, scope, scope_from, scope_to
       FROM aaelink.ediscovery_exports WHERE id = $1`,
    [exportId]
  )
  const row = rows[0]
  if (!row) throw new Error(`compliance_export: export ${exportId} not found`)

  await pool.query(
    `UPDATE aaelink.ediscovery_exports SET status = 'running' WHERE id = $1`, [exportId]
  )

  const from = Number(row.scope_from || 0)
  const to = Number(row.scope_to || 0)
  const scope = (typeof row.scope === 'object' && row.scope ? row.scope : {}) as { channel_ids?: string[] }
  const channelIds = Array.isArray(scope.channel_ids) ? scope.channel_ids : []

  const [messages, audit] = await Promise.all([
    loadExportMessages(pool, from, to, channelIds),
    loadExportAudit(pool, from, to),
  ])

  const artifact = buildArtifact(row.format || 'json', messages, audit)
  const downloadKey = `ediscovery/${exportId}.${artifact.extension}`

  const s3 = getS3Client()
  if (!s3) {
    await pool.query(
      `UPDATE aaelink.ediscovery_exports SET status = 'failed' WHERE id = $1`, [exportId]
    )
    throw new Error('compliance_export: S3 not configured (S3_ENDPOINT missing)')
  }

  await putObjectBytes({
    s3, bucket: getBucket(), key: downloadKey,
    body: artifact.body, contentType: artifact.contentType,
  })

  await pool.query(
    `UPDATE aaelink.ediscovery_exports
        SET status = 'completed', download_key = $2,
            message_count = $3, file_count = 0, size_bytes = $4, completed_at = $5
      WHERE id = $1`,
    [exportId, downloadKey, artifact.messageCount, artifact.body.length, Date.now()]
  )

  writeAuditLog({
    pool,
    action: 'compliance.export.complete',
    resourceKind: 'ediscovery_export',
    resourceId: exportId,
    metadata: {
      download_key: downloadKey, message_count: artifact.messageCount,
      audit_count: artifact.auditCount, size_bytes: artifact.body.length,
      format: row.format || 'json',
    },
  })

  return {
    exportId, downloadKey,
    messageCount: artifact.messageCount, sizeBytes: artifact.body.length,
  }
}
