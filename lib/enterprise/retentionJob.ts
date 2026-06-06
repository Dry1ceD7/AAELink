/**
 * retention_enforce job orchestration.
 *
 * Reads enabled retention policies, computes per-scope cutoffs, and deletes
 * messages / file_attachments older than the window — while excluding any
 * content protected by an active legal hold. Audited via writeAuditLog.
 *
 * File deletion is byte-aware: it removes the underlying storage object (S3 or
 * local, including any generated thumbnail) before dropping the row, and it
 * cleans up every dependent row so nothing dangles — the search index
 * (file_index), virus-scan records (file_scans), and public share links
 * (file_public_links). Without this the old DELETE-only path orphaned objects
 * in S3/disk forever and left phantom search hits / live public URLs.
 */
import type { Pool } from 'pg'
import {
  cutoffForPolicy, loadActiveHolds, buildHoldExclusion, buildFileHoldExclusion,
  type RetentionPolicyRow, type RetentionResult,
} from './retentionEnforcer'
import { removeFileObject } from '@/lib/files/storage'
import { writeAuditLog } from './auditLog'

const CHANNEL_TYPE_BY_SCOPE: Record<string, string[]> = {
  workspace: [], // all channels
  channel: ['O', 'P'],
  dm: ['D'],
}

/** Batch size for the file purge loop — bounds each transaction's footprint. */
const FILE_BATCH = 500

async function deleteMessages(
  pool: Pool, cutoffMs: number, channelTypes: string[], holdsClause: string, holdsParams: unknown[]
): Promise<number> {
  const params: unknown[] = [cutoffMs]
  let typeFilter = ''
  if (channelTypes.length > 0) {
    params.push(channelTypes)
    typeFilter = ` AND c.type = ANY($${params.length}::text[])`
  }
  // Hold params follow the message params; re-number happens at call site.
  const { rowCount } = await pool.query(
    `DELETE FROM aaelink.messages m
       USING aaelink.channels c
      WHERE m.channel_id = c.id
        AND m.created_at < $1${typeFilter}${holdsClause}`,
    [...params, ...holdsParams]
  )
  return rowCount || 0
}

interface ExpiredFileRow {
  id: string
  storage_key: string
  storage_backend: string | null
  thumbnail_key: string | null
}

/**
 * Purge file_attachments past the cutoff in bounded batches.
 *
 * Per batch we (1) read the storage coordinates for the doomed rows (honoring
 * the legal-hold exclusion — channel, custodian, AND the NULL-channel safety in
 * buildFileHoldExclusion), then in a SINGLE transaction (2) delete every
 * dependent row keyed off those ids and the file rows themselves, COMMIT, and
 * only THEN (3) best-effort remove the underlying bytes (primary object +
 * thumbnail). Doing the byte removal AFTER commit makes the DB row the durable
 * source of truth: a crash can leave bytes orphaned (reclaimable later) but can
 * never leave a 'live' file_attachments row pointing at deleted bytes.
 *
 * Dependent rows cleaned: file_index, file_scans (no FK to file_attachments —
 * would dangle forever), file_public_links (ON DELETE CASCADE — deleted
 * explicitly anyway so the cascade is not the only safety net), and
 * message_attachments + clips (also carry file_id with NO FK/CASCADE, so they
 * would dangle as stale eDiscovery references without an explicit DELETE).
 *
 * Soft-deleted rows (deleted_at <> 0) that are also past the cutoff are swept in
 * the SAME pass: the files route soft-deletes but leaves the metadata row (and,
 * for legacy soft-deletes, the bytes) lingering forever, so an enabled file
 * policy is the place that finally reclaims them.
 *
 * The hold exclusion always wins: a soft-deleted row under an active hold — or
 * an unattached (NULL-channel) row while any channel-scoped hold exists — is NOT
 * purged, preserving compliance semantics and never spoliating held evidence.
 */
async function deleteFiles(
  pool: Pool, cutoffMs: number, holds: Awaited<ReturnType<typeof loadActiveHolds>>
): Promise<number> {
  let totalDeleted = 0

  for (;;) {
    // File hold exclusion keys off channel_id / created_at / user_id (custodian)
    // and additionally protects NULL-channel rows while a channel hold is active.
    // Params: $1 cutoff, $2 batch limit, then the hold params start at $3.
    const ex = buildFileHoldExclusion(holds, 'channel_id', 'created_at', 'user_id', 3)
    const { rows } = await pool.query<ExpiredFileRow>(
      `SELECT id, storage_key, storage_backend, thumbnail_key
         FROM aaelink.file_attachments
        WHERE created_at < $1${ex.clause}
        ORDER BY created_at ASC
        LIMIT $2`,
      [cutoffMs, FILE_BATCH, ...ex.params]
    )

    if (rows.length === 0) break

    const ids = rows.map((r) => r.id)

    // (2) Atomic row + dependent-row delete. The row delete is the durable
    // source of truth; byte removal happens only after this commits.
    const client = await pool.connect()
    let deletedThisBatch = 0
    try {
      await client.query('BEGIN')
      await client.query(
        `DELETE FROM aaelink.file_index WHERE file_id = ANY($1::text[])`, [ids]
      )
      await client.query(
        `DELETE FROM aaelink.file_scans WHERE file_id = ANY($1::text[])`, [ids]
      )
      await client.query(
        `DELETE FROM aaelink.file_public_links WHERE file_id = ANY($1::text[])`, [ids]
      )
      await client.query(
        `DELETE FROM aaelink.message_attachments WHERE file_id = ANY($1::text[])`, [ids]
      )
      await client.query(
        `DELETE FROM aaelink.clips WHERE file_id = ANY($1::text[])`, [ids]
      )
      const { rowCount } = await client.query(
        `DELETE FROM aaelink.file_attachments WHERE id = ANY($1::text[])`, [ids]
      )
      await client.query('COMMIT')
      deletedThisBatch = rowCount || 0
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      client.release()
    }
    totalDeleted += deletedThisBatch

    // (3) AFTER commit, best-effort remove the bytes — primary object +
    // thumbnail. removeFileObject swallows its own errors, but guard anyway so
    // one bad object can never abort the purge. A failure here leaves orphaned
    // bytes (reclaimable) but never a live row pointing at deleted bytes.
    for (const r of rows) {
      try {
        await removeFileObject(r.storage_key, r.storage_backend)
      } catch { /* never throws */ }
      if (r.thumbnail_key) {
        try {
          await removeFileObject(r.thumbnail_key, r.storage_backend)
        } catch { /* never throws */ }
      }
    }

    // Loop terminates: a full batch means there may be more; a short batch
    // (or zero) means we are done. The DELETE removes exactly the rows we just
    // read, so the next SELECT cannot return the same ids.
    if (rows.length < FILE_BATCH) break
  }

  return totalDeleted
}

export async function runRetentionEnforcement(pool: Pool): Promise<RetentionResult[]> {
  const { rows: policies } = await pool.query<RetentionPolicyRow>(
    `SELECT scope, retention_days, enabled, delete_files
       FROM aaelink.retention_policies
      WHERE enabled = true AND retention_days > 0`
  )
  if (policies.length === 0) return []

  const holds = await loadActiveHolds(pool)
  const results: RetentionResult[] = []

  for (const p of policies) {
    const cutoffMs = cutoffForPolicy(p.retention_days)
    let messagesDeleted = 0
    let filesDeleted = 0

    const channelTypes = CHANNEL_TYPE_BY_SCOPE[p.scope] ?? []
    const isMessageScope = p.scope === 'workspace' || p.scope === 'channel' || p.scope === 'dm'

    if (isMessageScope) {
      // Message hold exclusion keys off m.channel_id / m.created_at / m.user_id
      // (custodian). messages.channel_id is NOT NULL so no NULL-channel guard is
      // needed here (the file path handles that). Params already used: $1 cutoff,
      // then optional channelTypes.
      const nextIdx = channelTypes.length > 0 ? 3 : 2
      const ex = buildHoldExclusion(holds, 'm.channel_id', 'm.created_at', nextIdx, 'm.user_id')
      messagesDeleted = await deleteMessages(pool, cutoffMs, channelTypes, ex.clause, ex.params)
    }

    if (p.scope === 'file' || p.delete_files) {
      filesDeleted = await deleteFiles(pool, cutoffMs, holds)
    }

    results.push({ scope: p.scope, cutoffMs, messagesDeleted, filesDeleted })

    writeAuditLog({
      pool,
      action: 'retention.enforce',
      resourceKind: 'policy',
      resourceId: p.scope,
      metadata: {
        scope: p.scope, retention_days: p.retention_days,
        messages_deleted: messagesDeleted, files_deleted: filesDeleted,
        active_holds: holds.length,
      },
    })
  }

  return results
}
