/**
 * Two-phase / resumable upload sessions — Slack files.getUploadURLExternal →
 * upload → files.completeUploadExternal parity, scaled to 5 GB.
 *
 * A single-shot POST /api/files/upload buffers the whole file in memory, which
 * caps practical uploads well below Slack's large-file ceiling. This module
 * backs a chunked, resumable flow:
 *
 *   1. createUploadSession  — validate name/extension/size against the org scan
 *      policy (shared lib/files/uploadPolicy helper) with a 5 GB hard ceiling;
 *      pre-allocate the future file id + storage key; for S3 begin a multipart
 *      upload now, for local create a sparse partial file. Returns part_size.
 *   2. appendPart           — accept one fixed-size part (final part may be
 *      short). S3: UploadPart → record ETag. Local: positional write at
 *      (partNumber-1)*part_size (parts may arrive out of order). Tracks received
 *      bytes + completed part numbers; over-declared size aborts the session.
 *   3. completeUploadSession — require all parts; S3 CompleteMultipartUpload with
 *      recorded ETags, local rename partial → final; INSERT the canonical
 *      file_attachments row + enqueue the post-upload pipeline; mark completed.
 *   4. abortUploadSession   — owner abort; release S3 multipart / unlink partial.
 *   5. sweepExpiredUploadSessions — worker heartbeat: expire + clean stale active
 *      sessions (same cleanup as abort).
 *
 * CONCURRENCY: parts_received is updated with a read-modify-write guarded by an
 * optimistic `WHERE id = $ AND status = 'active' AND version = $prev` plus a
 * `version = version + 1` bump and a bounded retry loop. The version counter is
 * a monotonic token (NOT the wall-clock updated_at, which two same-millisecond
 * appends could both match — silently dropping a part). This serializes
 * concurrent appendPart calls on the same session (and is also why a complete
 * in-flight — which flips status away from 'active' — makes any racing append
 * fail its guard, returning 409). We chose read-modify-write over a SQL
 * jsonb_agg merge because we must also recompute received_bytes and detect
 * duplicate parts in the same critical section.
 *
 * COMPLETE ORDERING: completeUploadSession does the active-guarded status flip
 * ('active' → 'completed') FIRST, then finalizes storage. That claim is the
 * linearization point — every competing mutator (abort, sweep, another complete,
 * a racing append) guards on status='active', so once a complete wins none of
 * them can abort the S3 multipart / unlink the partial out from under it, and
 * the loser of the claim returns the same attachment idempotently.
 *
 * STORAGE KEY: the future file id is generated UP FRONT at create. The S3 object
 * key is the same 'chat/<file-id>/<safeName>' form storeFileBytes uses, so the
 * completed row resolves bytes identically to a single-shot upload. Local final
 * key is the flat '<id><ext>' form; the partial lands at
 * '<uploads>/partial/<session-id>.part' and is renamed at complete.
 */
import fsp from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import type { Pool } from 'pg'
import {
  getS3Client,
  getBucket,
  createMultipartUpload,
  uploadPart,
  completeMultipartUpload,
  abortMultipartUpload,
  headObjectSize,
  type UploadedPart,
} from '@/lib/infra/s3'
import { UPLOAD_DIR, type StorageBackend } from '@/lib/files/storage'
import { getScanPolicy } from '@/lib/files/scanGate'
import { checkUploadPolicy, MULTIPART_MAX_BYTES } from '@/lib/files/uploadPolicy'
import { enqueueUploadJobs } from '@/lib/files/fileJobs'
import { writeAuditLog } from '@/lib/enterprise/auditLog'
import { log } from '@/lib/infra/log'

// Fixed 8 MB part size. S3 requires every non-final part be >= 5 MB, so a fixed
// 8 MB keeps every interior part comfortably legal while the final part may be
// short. Clients learn it from the create response and chunk accordingly.
export const PART_SIZE = 8 * 1024 * 1024

// 24h TTL. An unfinished session past this is swept (S3 multipart aborted /
// local partial unlinked) so abandoned uploads never accumulate storage.
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000

// Server-generated session ids are UUIDv4; validate the shape before EVER
// interpolating an id into a filesystem path (defense-in-depth against path
// traversal even though the id is server-minted, never client-supplied).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Max read-modify-write retries before surfacing a contention error. */
const MAX_APPEND_RETRIES = 8

/**
 * Per-user cap on concurrently-open active sessions. Each active session can
 * stage up to one full file's worth of bytes (S3 multipart parts / a local
 * partial) until complete or the 24h TTL sweep, so without this bound a single
 * user could open thousands of sessions and reserve N * cap storage — an
 * aggregate size-limit bypass the per-file declared_size check does not cover.
 */
export const MAX_ACTIVE_SESSIONS_PER_USER =
  Number(process.env.UPLOAD_SESSION_MAX_ACTIVE_PER_USER) || 25

export type SessionStatus = 'active' | 'completed' | 'aborted' | 'expired'

export interface UploadSessionRow {
  id: string
  user_id: string
  workspace_id: string | null
  channel_id: string | null
  filename: string
  content_type: string
  declared_size: string // BIGINT → string from pg
  received_bytes: string
  part_size: number
  parts_received: number[]
  backend: StorageBackend
  s3_upload_id: string
  s3_parts: UploadedPart[]
  storage_key: string
  status: SessionStatus
  file_id: string
  version: number
  created_at: string
  updated_at: string
  expires_at: string
}

/** Sanitize a filename for an object key (no path separators / NULs). */
function safeName(filename: string): string {
  return filename.replace(/[/\\]+/g, '_').replace(/\0/g, '')
}

/** Total number of parts a session of this declared size requires. */
export function expectedPartCount(declaredSize: number, partSize: number): number {
  if (declaredSize <= 0) return 0
  return Math.ceil(declaredSize / partSize)
}

/** Local partial-file path for a session (validates the id shape first). */
function partialPath(sessionId: string): string {
  if (!UUID_RE.test(sessionId)) throw new Error('invalid_session_id')
  return path.join(UPLOAD_DIR, 'partial', `${sessionId}.part`)
}

interface RawSessionRow {
  id: string
  user_id: string
  workspace_id: string | null
  channel_id: string | null
  filename: string
  content_type: string
  declared_size: string
  received_bytes: string
  part_size: number
  parts_received: unknown
  backend: string
  s3_upload_id: string
  s3_parts: unknown
  storage_key: string
  status: string
  file_id: string
  version: string | number
  created_at: string
  updated_at: string
  expires_at: string
}

function hydrate(r: RawSessionRow): UploadSessionRow {
  const parts = Array.isArray(r.parts_received)
    ? (r.parts_received as number[])
    : JSON.parse(String(r.parts_received || '[]'))
  const s3parts = Array.isArray(r.s3_parts)
    ? (r.s3_parts as UploadedPart[])
    : JSON.parse(String(r.s3_parts || '[]'))
  return {
    ...r,
    backend: (r.backend === 's3' ? 's3' : 'local'),
    status: r.status as SessionStatus,
    parts_received: parts,
    s3_parts: s3parts,
    version: Number(r.version ?? 0),
  }
}

const SELECT_COLS = `id, user_id, workspace_id, channel_id, filename, content_type,
  declared_size::text, received_bytes::text, part_size, parts_received, backend,
  s3_upload_id, s3_parts, storage_key, status, file_id, version,
  created_at::text, updated_at::text, expires_at::text`

/** Fetch one session row (hydrated) or null. */
export async function getUploadSession(pool: Pool, id: string): Promise<UploadSessionRow | null> {
  const { rows } = await pool.query<RawSessionRow>(
    `SELECT ${SELECT_COLS} FROM aaelink.upload_sessions WHERE id = $1`, [id]
  )
  return rows[0] ? hydrate(rows[0]) : null
}

// ── Errors ────────────────────────────────────────────────────────────
// Logic throws typed errors; routes map .code → HTTP status + snake_case body.

export class UploadSessionError extends Error {
  constructor(
    public code: string,
    public status: number,
    public extra?: Record<string, unknown>,
  ) {
    super(code)
    this.name = 'UploadSessionError'
  }
}

// ── Create ──────────────────────────────────────────────────────────────

export interface CreateUploadSessionInput {
  uid: string
  filename: string
  contentType?: string
  declaredSize: number
  channelId?: string | null
}

export async function createUploadSession(
  pool: Pool,
  input: CreateUploadSessionInput,
): Promise<UploadSessionRow> {
  const filename = String(input.filename || '').trim()
  if (!filename) throw new UploadSessionError('filename_required', 400)

  const declaredSize = Number(input.declaredSize)
  if (!Number.isFinite(declaredSize) || declaredSize <= 0 || !Number.isInteger(declaredSize)) {
    throw new UploadSessionError('invalid_declared_size', 400)
  }

  // Same org policy as the single-shot route, BUT the built-in default cap is
  // the 5 GB multipart ceiling (a policy cap still REPLACES it when set).
  const policy = await getScanPolicy(pool)
  const check = checkUploadPolicy(
    { filename, size: declaredSize, defaultMaxBytes: MULTIPART_MAX_BYTES },
    policy,
  )
  if (!check.ok) {
    if (check.error === 'file_too_large') {
      throw new UploadSessionError('file_too_large', 413, { max: check.max })
    }
    throw new UploadSessionError('extension_blocked', 415, { extension: check.extension })
  }

  // Per-user concurrent-session cap: bound how many active sessions one user can
  // hold open BEFORE we allocate any S3 multipart / local partial storage, so a
  // flood of create calls can't reserve unbounded staged bytes (aggregate
  // size-cap bypass). Counted, not size-summed, since each session is already
  // per-file bounded by the declared_size check above.
  const { rows: activeRows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM aaelink.upload_sessions
      WHERE user_id = $1 AND status = 'active'`,
    [input.uid]
  )
  if (Number(activeRows[0]?.count || 0) >= MAX_ACTIVE_SESSIONS_PER_USER) {
    throw new UploadSessionError('too_many_active_sessions', 429, {
      max_active: MAX_ACTIVE_SESSIONS_PER_USER,
    })
  }

  // Resolve the owning workspace from the channel (mirrors the upload route) so
  // the completed row is workspace-scoped for list/info/delete.
  let workspaceId: string | null = null
  const channelId = String(input.channelId || '').trim() || null
  if (channelId) {
    const { rows } = await pool.query<{ workspace_id: string }>(
      `SELECT workspace_id FROM aaelink.channels WHERE id = $1`, [channelId]
    )
    workspaceId = rows[0]?.workspace_id ?? null
  }

  const sessionId = randomUUID()
  const fileId = randomUUID()
  const contentType = String(input.contentType || '').trim() || 'application/octet-stream'
  const ext = path.extname(filename) || ''

  // Choose backend by S3 presence (mirrors storage.ts). Compute storage_key UP
  // FRONT so complete is deterministic: S3 'chat/<file-id>/<safeName>', local
  // flat '<file-id><ext>'.
  const s3 = getS3Client()
  let backend: StorageBackend
  let storageKey: string
  let s3UploadId = ''

  if (s3) {
    backend = 's3'
    storageKey = `chat/${fileId}/${safeName(filename)}`
    s3UploadId = await createMultipartUpload({
      s3, bucket: getBucket(), key: storageKey, contentType,
    })
  } else {
    backend = 'local'
    storageKey = `${fileId}${ext}`
    // Pre-create the partial file so out-of-order positional writes have a
    // target. 'w' truncates/creates; the directory is ensured first.
    const partial = partialPath(sessionId)
    await fsp.mkdir(path.dirname(partial), { recursive: true })
    await fsp.writeFile(partial, Buffer.alloc(0))
  }

  const now = Date.now()
  const expiresAt = now + SESSION_TTL_MS

  // Storage is already allocated (S3 multipart begun / local partial created). If
  // the INSERT (or the reload) fails, there is no DB row — so the sweep/abort
  // paths can never see it — and the S3 multipart would be a permanent orphan
  // counting against bucket quota. Best-effort release the staged storage before
  // rethrowing so a failed create leaks nothing.
  try {
    await pool.query(
      `INSERT INTO aaelink.upload_sessions
         (id, user_id, workspace_id, channel_id, filename, content_type, declared_size,
          received_bytes, part_size, parts_received, backend, s3_upload_id, s3_parts,
          storage_key, status, file_id, version, created_at, updated_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, 0, $8, '[]'::jsonb, $9, $10, '[]'::jsonb,
               $11, 'active', $12, 0, $13, $13, $14)`,
      [
        sessionId, input.uid, workspaceId, channelId, filename, contentType, declaredSize,
        PART_SIZE, backend, s3UploadId, storageKey, fileId, now, expiresAt,
      ]
    )

    const created = await getUploadSession(pool, sessionId)
    if (!created) throw new UploadSessionError('session_create_failed', 503)
    return created
  } catch (err) {
    if (backend === 's3' && s3 && s3UploadId) {
      try {
        await abortMultipartUpload({ s3, bucket: getBucket(), key: storageKey, uploadId: s3UploadId })
      } catch { /* best-effort */ }
    } else if (backend === 'local') {
      try {
        await fsp.unlink(partialPath(sessionId))
      } catch { /* already gone */ }
    }
    throw err
  }
}

// ── Append part ───────────────────────────────────────────────────────

export interface AppendPartResult {
  status: SessionStatus
  received_bytes: number
  parts_received: number[]
  /** True when this exact part was already recorded (idempotent no-op). */
  duplicate: boolean
}

export async function appendPart(
  pool: Pool,
  params: { sessionId: string; partNumber: number; bytes: Buffer; uid: string },
): Promise<AppendPartResult> {
  const { sessionId, partNumber, bytes, uid } = params

  // Read-modify-write loop guarded by optimistic concurrency on updated_at.
  for (let attempt = 0; attempt < MAX_APPEND_RETRIES; attempt++) {
    const session = await getUploadSession(pool, sessionId)
    if (!session) throw new UploadSessionError('session_not_found', 404)
    if (session.user_id !== uid) throw new UploadSessionError('forbidden', 403)
    if (session.status !== 'active') throw new UploadSessionError('session_not_active', 409)

    const declaredSize = Number(session.declared_size)
    const totalParts = expectedPartCount(declaredSize, session.part_size)

    // part_number injection guard: must be an integer in [1, totalParts].
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > totalParts) {
      throw new UploadSessionError('invalid_part_number', 400, { total_parts: totalParts })
    }

    // Final part may be short; all interior parts must be exactly part_size.
    const isFinal = partNumber === totalParts
    const expectedLen = isFinal
      ? declaredSize - session.part_size * (totalParts - 1)
      : session.part_size
    if (bytes.length !== expectedLen) {
      throw new UploadSessionError('part_size_mismatch', 400, {
        expected: expectedLen, got: bytes.length,
      })
    }

    // Idempotent: a re-sent part is a no-op success (so a client retry after a
    // dropped response is safe). We do NOT re-upload the bytes.
    if (session.parts_received.includes(partNumber)) {
      return {
        status: session.status,
        received_bytes: Number(session.received_bytes),
        parts_received: session.parts_received,
        duplicate: true,
      }
    }

    // Cumulative size ceiling: never let recorded bytes exceed the declared
    // size. With exact part-size enforcement this can only trip on a malformed
    // declared/part mismatch, but it is the hard backstop that triggers abort.
    const newReceived = Number(session.received_bytes) + bytes.length
    if (newReceived > declaredSize) {
      await abortUploadSession(pool, { sessionId, uid, reason: 'size_exceeded' })
      throw new UploadSessionError('size_exceeded', 413, { declared_size: declaredSize })
    }

    // Persist the bytes for THIS part to the chosen backend BEFORE recording it.
    // S3 returns an ETag we must capture; local writes positionally so out-of-
    // order parts land at the right offset.
    let newS3Parts = session.s3_parts
    if (session.backend === 's3') {
      const s3 = getS3Client()
      if (!s3) throw new UploadSessionError('storage_unavailable', 503)
      const etag = await uploadPart({
        s3, bucket: getBucket(), key: session.storage_key,
        uploadId: session.s3_upload_id, partNumber, body: bytes,
      })
      newS3Parts = [...session.s3_parts.filter((p) => p.partNumber !== partNumber), { partNumber, etag }]
    } else {
      const partial = partialPath(sessionId)
      const offset = (partNumber - 1) * session.part_size
      // Positional write — parts may arrive out of order, so we open 'r+' and
      // seek. The file is pre-created at session create; fall back to 'w+' if a
      // crash removed it mid-flight.
      let fh: fsp.FileHandle
      try {
        fh = await fsp.open(partial, 'r+')
      } catch {
        await fsp.mkdir(path.dirname(partial), { recursive: true })
        fh = await fsp.open(partial, 'w+')
      }
      try {
        await fh.write(bytes, 0, bytes.length, offset)
      } finally {
        await fh.close()
      }
    }

    const newParts = [...session.parts_received, partNumber].sort((a, b) => a - b)
    const now = Date.now()

    // Optimistic concurrency: only commit if no other append/complete touched
    // the row since we read it. We guard on a monotonic `version` counter, NOT
    // on the wall-clock updated_at: two appends reading the same base row within
    // the same millisecond could both match an updated_at guard (the winning
    // write left updated_at unchanged), and the loser would overwrite the
    // winner's parts_received/received_bytes — silently dropping a part. The
    // version bump (version = version + 1) is guaranteed distinct per write, so
    // the loser's `version = $prev` guard always fails and the retry loop re-reads
    // the merged base. The status='active' guard additionally loses the race to a
    // concurrent complete (which flips status), keeping the JSONB consistent.
    const { rowCount } = await pool.query(
      `UPDATE aaelink.upload_sessions
          SET received_bytes = $1, parts_received = $2::jsonb, s3_parts = $3::jsonb,
              updated_at = $4, version = version + 1
        WHERE id = $5 AND status = 'active' AND version = $6`,
      [
        newReceived, JSON.stringify(newParts), JSON.stringify(newS3Parts), now,
        sessionId, session.version,
      ]
    )

    if (rowCount === 1) {
      return { status: 'active', received_bytes: newReceived, parts_received: newParts, duplicate: false }
    }
    // Lost the optimistic race (or status changed). Re-read and retry; if the
    // session went non-active the next loop iteration surfaces the right error.
  }

  throw new UploadSessionError('append_contention', 409)
}

// ── Complete ────────────────────────────────────────────────────────────

export interface CompleteUploadResult {
  attachment: {
    id: string
    filename: string
    content_type: string
    size: number
    storage_key: string
    download_url: string
  }
}

export async function completeUploadSession(
  pool: Pool,
  params: { sessionId: string; uid: string },
): Promise<CompleteUploadResult> {
  const { sessionId, uid } = params
  const session = await getUploadSession(pool, sessionId)
  if (!session) throw new UploadSessionError('session_not_found', 404)
  if (session.user_id !== uid) throw new UploadSessionError('forbidden', 403)
  if (session.status === 'completed') {
    // Idempotent: completing an already-completed session returns the result.
    return buildAttachment(session)
  }
  if (session.status !== 'active') throw new UploadSessionError('session_not_active', 409)

  const declaredSize = Number(session.declared_size)
  const totalParts = expectedPartCount(declaredSize, session.part_size)
  const missing: number[] = []
  for (let n = 1; n <= totalParts; n++) {
    if (!session.parts_received.includes(n)) missing.push(n)
  }
  if (missing.length) {
    throw new UploadSessionError('parts_missing', 409, { missing })
  }

  // CLAIM the session FIRST with an active-guarded status flip, BEFORE touching
  // storage. This is the linearization point: exactly one caller can win the
  // 'active' → 'completed' transition, and every competing mutator
  // (abortUploadSession, sweepExpiredUploadSessions, another completeUploadSession,
  // any racing appendPart) guards on status='active', so once we win none of them
  // can abort the S3 multipart / unlink the partial out from under us. Finalizing
  // storage AFTER the claim therefore can never hit a NoSuchUpload from a
  // concurrent abort (the medium finding) nor a double-finalize from interleaved
  // completes (the low finding) — the loser of the claim returns idempotently.
  const now = Date.now()
  const { rowCount } = await pool.query(
    `UPDATE aaelink.upload_sessions
        SET status = 'completed', updated_at = $1
      WHERE id = $2 AND status = 'active'`,
    [now, sessionId]
  )
  if (rowCount !== 1) {
    // Lost the claim — another request is finishing (or finished) this session.
    const latest = await getUploadSession(pool, sessionId)
    if (latest?.status === 'completed') return buildAttachment(latest)
    throw new UploadSessionError('session_not_active', 409)
  }

  // Finalize storage now that we exclusively own the session.
  if (session.backend === 's3') {
    const s3 = getS3Client()
    if (!s3) throw new UploadSessionError('storage_unavailable', 503)
    await completeMultipartUpload({
      s3, bucket: getBucket(), key: session.storage_key,
      uploadId: session.s3_upload_id, parts: session.s3_parts,
    })
    // Backstop mirroring the local fsp.stat check: HEAD the completed object and
    // verify its ContentLength matches the declared size, so corrupt/short
    // assembly never gets promoted to a file_attachments row with a wrong size.
    // A null length means HEAD failed/omitted it — skip rather than false-reject.
    const actual = await headObjectSize(s3, getBucket(), session.storage_key)
    if (actual !== null && actual !== declaredSize) {
      throw new UploadSessionError('size_mismatch', 409, { declared_size: declaredSize, actual })
    }
  } else {
    const partial = partialPath(sessionId)
    // Sanity: the assembled partial must match the declared size before promote.
    let size = 0
    try {
      const stat = await fsp.stat(partial)
      size = stat.size
    } catch {
      throw new UploadSessionError('partial_missing', 409)
    }
    if (size !== declaredSize) {
      throw new UploadSessionError('size_mismatch', 409, { declared_size: declaredSize, actual: size })
    }
    await fsp.mkdir(UPLOAD_DIR, { recursive: true })
    await fsp.rename(partial, path.join(UPLOAD_DIR, session.storage_key))
  }

  // INSERT the canonical file row (same columns as the single-shot upload).
  await pool.query(
    `INSERT INTO aaelink.file_attachments
       (id, message_id, channel_id, workspace_id, user_id, filename, content_type, size, storage_key, storage_backend, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (id) DO NOTHING`,
    [
      session.file_id, null, session.channel_id, session.workspace_id, session.user_id,
      session.filename, session.content_type, declaredSize, session.storage_key,
      session.backend, now,
    ]
  )

  // Fire-and-forget the post-upload pipeline (scan + index + thumbnail).
  try {
    await enqueueUploadJobs(pool, {
      fileId: session.file_id,
      filename: session.filename,
      fileSize: declaredSize,
      mimeType: session.content_type,
      uploadedBy: session.user_id,
    })
  } catch (err) {
    log.error('upload session complete: enqueue pipeline jobs failed', {
      name: 'files.upload_session.enqueue',
      error: err instanceof Error ? err.message : String(err),
    })
  }

  writeAuditLog({
    pool,
    workspaceId: session.workspace_id ?? undefined,
    actorId: session.user_id,
    action: 'file.upload_session.complete',
    resourceKind: 'file',
    resourceId: session.file_id,
    metadata: {
      session_id: session.id,
      channel_id: session.channel_id,
      size: declaredSize,
      backend: session.backend,
    },
  })

  return buildAttachment(session)
}

function buildAttachment(session: UploadSessionRow): CompleteUploadResult {
  return {
    attachment: {
      id: session.file_id,
      filename: session.filename,
      content_type: session.content_type || 'application/octet-stream',
      size: Number(session.declared_size),
      storage_key: session.storage_key,
      download_url: `/api/files/${session.file_id}/download`,
    },
  }
}

// ── Abort ─────────────────────────────────────────────────────────────

export async function abortUploadSession(
  pool: Pool,
  params: { sessionId: string; uid: string; reason?: string },
): Promise<void> {
  const { sessionId, uid } = params
  const session = await getUploadSession(pool, sessionId)
  if (!session) throw new UploadSessionError('session_not_found', 404)
  if (session.user_id !== uid) throw new UploadSessionError('forbidden', 403)
  // Idempotent on already-terminal sessions.
  if (session.status !== 'active') return

  // Claim the abort with an active-guarded flip BEFORE releasing storage, so a
  // complete that already won the 'active' → 'completed' claim is never aborted
  // from under (and we never abort an S3 multipart a complete is finalizing).
  const { rowCount } = await pool.query(
    `UPDATE aaelink.upload_sessions SET status = 'aborted', updated_at = $1
      WHERE id = $2 AND status = 'active'`,
    [Date.now(), sessionId]
  )
  if (rowCount !== 1) return // lost the race to a complete/abort/sweep — leave it.

  await cleanupStorage(session)

  writeAuditLog({
    pool,
    workspaceId: session.workspace_id ?? undefined,
    actorId: session.user_id,
    action: 'file.upload_session.abort',
    resourceKind: 'upload_session',
    resourceId: session.id,
    metadata: { reason: params.reason || 'user_abort', received_bytes: Number(session.received_bytes) },
  })
}

/** Release whatever storage a session staged (S3 multipart / local partial). */
async function cleanupStorage(session: UploadSessionRow): Promise<void> {
  if (session.backend === 's3') {
    const s3 = getS3Client()
    if (s3 && session.s3_upload_id) {
      try {
        await abortMultipartUpload({
          s3, bucket: getBucket(), key: session.storage_key, uploadId: session.s3_upload_id,
        })
      } catch { /* best-effort */ }
    }
  } else {
    try {
      const partial = partialPath(session.id)
      await fsp.unlink(partial)
    } catch { /* already gone */ }
  }
}

// ── Sweep (worker heartbeat) ────────────────────────────────────────────

/** Rows fetched per sweep batch — bounds one DB round-trip + cleanup pass. */
export const SWEEP_BATCH_SIZE = 200

/**
 * Max sessions a single sweep invocation will clean across all its batches. A
 * safety cap so a pathological backlog (e.g. millions of expired rows after a
 * long outage) can't monopolize the worker for one invocation — the remainder is
 * picked up by the next hourly run, but the common post-outage backlog (a few
 * thousand) now drains in ONE invocation instead of at 200/hour.
 */
export const SWEEP_MAX_PER_INVOCATION = 5000

/**
 * Expire + clean one bounded batch of stale active sessions.
 * Returns { selected, cleaned }: `selected` is the SELECTed row count (a full
 * batch signals more may remain), `cleaned` is how many we actually flipped +
 * cleaned (a row that lost the active-guard to a concurrent finish is selected
 * but not cleaned).
 */
async function sweepBatch(pool: Pool, now: number): Promise<{ selected: number; cleaned: number }> {
  const { rows } = await pool.query<RawSessionRow>(
    `SELECT ${SELECT_COLS} FROM aaelink.upload_sessions
      WHERE status = 'active' AND expires_at < $1
      ORDER BY expires_at ASC
      LIMIT ${SWEEP_BATCH_SIZE}`,
    [now]
  )
  let cleaned = 0
  for (const raw of rows) {
    const session = hydrate(raw)
    // Guarded flip first: if it loses to a concurrent finish, skip cleanup so we
    // don't release storage out from under an in-flight complete.
    const { rowCount } = await pool.query(
      `UPDATE aaelink.upload_sessions SET status = 'expired', updated_at = $1
        WHERE id = $2 AND status = 'active'`,
      [now, session.id]
    )
    if (rowCount !== 1) continue
    await cleanupStorage(session)
    cleaned++
  }
  return { selected: rows.length, cleaned }
}

/**
 * Drain expired active sessions whose TTL has passed. Repeatedly cleans bounded
 * batches (SWEEP_BATCH_SIZE each) until a batch comes back short (backlog
 * cleared) or the SWEEP_MAX_PER_INVOCATION cap is hit, so a >200 backlog clears
 * in one invocation instead of at 200/hour. Same cleanup as abort; status set to
 * 'expired'. The status='active' guard in each per-row UPDATE loses the race to a
 * concurrent appendPart/complete, so we never expire a session being actively
 * finished. Returns the number of sessions expired this invocation.
 */
export async function sweepExpiredUploadSessions(pool: Pool, now = Date.now()): Promise<number> {
  let expired = 0
  // Hard upper bound on batches as a belt-and-suspenders guard against an
  // infinite loop if the clock/rows somehow never shrink the candidate set.
  const maxBatches = Math.ceil(SWEEP_MAX_PER_INVOCATION / SWEEP_BATCH_SIZE) + 1
  for (let batch = 0; batch < maxBatches; batch++) {
    const { selected, cleaned } = await sweepBatch(pool, now)
    expired += cleaned
    // Stop when the batch was short (no more candidates) or we hit the cap.
    if (selected < SWEEP_BATCH_SIZE || expired >= SWEEP_MAX_PER_INVOCATION) break
  }
  if (expired > 0) {
    log.info(`🧹 [upload_session_sweep] expired ${expired} stale upload session(s)`)
  }
  return expired
}
