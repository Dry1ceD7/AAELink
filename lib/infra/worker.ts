/**
 * AAELink Background Worker Runner
 *
 * Polls the `aaelink.jobs` table and executes pending jobs with:
 *   - Configurable polling interval
 *   - Concurrent worker limit
 *   - Exponential backoff on failure
 *   - Dead letter queue for exhausted retries
 *   - Graceful shutdown (SIGTERM/SIGINT)
 *   - Per-type job handlers
 *
 * Usage:
 *   npx tsx lib/worker.ts
 *   # or
 *   npm run worker
 *
 * Environment:
 *   DATABASE_URL — Postgres connection string
 *   WORKER_CONCURRENCY — max concurrent jobs (default: 5)
 *   WORKER_POLL_MS — poll interval in milliseconds (default: 2000)
 */

import type { Pool } from 'pg'
import { getPool } from '@/lib/infra/db'
import { log } from '@/lib/infra/log'
import { pruneExpiredOAuthTokens, pruneOAuthCodes } from '@/lib/auth/oauthCleanup'

// ── Configuration ────────────────────────────────────────────────────

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_MS) || 2000
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY) || 5
const RETRY_BACKOFF_BASE_MS = 1000

let running = true
let activeJobs = 0

// ── Database ─────────────────────────────────────────────────────────

/**
 * Resolve the singleton pool from `lib/db.ts`. Audit-2026-05-26 CRIT-003 —
 * the worker used to call `new Pool(...)` here, opening a second pool with
 * different sizing (max = CONCURRENCY + 2) on top of the API pool. Two pools
 * doubled the connection footprint and the worker pool was never closed on
 * graceful shutdown, accumulating idle connections after every redeploy.
 *
 * If the worker truly needs more headroom, raise `lib/db.ts` `max` once;
 * do not open a second pool here.
 */
function resolvePool(): Pool {
  const pool = getPool()
  if (!pool) {
    throw new Error(
      'Worker requires DATABASE_URL to be set so getPool() returns a live pool. ' +
      'Set it in the environment (see .env.example) before starting `npm run worker`.'
    )
  }
  return pool
}

// ── Job Type Handlers ────────────────────────────────────────────────

type JobPayload = Record<string, unknown>
type JobHandler = (payload: JobPayload, pool: Pool) => Promise<void>

interface JobRow {
  id: string; type: string; status: string; payload: string
  attempts: number; max_retries: number; priority: number
  run_after: number; created_at: number
}

interface ScheduledMessageRow {
  id: string; channel_id: string; user_id: string
  content: string; root_id: string | null; status: string
}

const handlers: Record<string, JobHandler> = {

  // Email sending
  email_send: async (payload) => {
    const { to, subject, html } = payload as { to: string; subject: string; html: string }
    // In production: use nodemailer/SES/SendGrid
    log.info(`📧 [email_send] To: ${to} | Subject: ${subject} | HTML: ${String(html).length} chars`)
    // Simulate send delay
    await sleep(200)
  },

  // Webhook retry (v2 — HMAC, exponential backoff)
  webhook_retry: async (payload, pool) => {
    const { webhook_id, event_type, payload: eventPayload, attempt, delivery_id } = payload as {
      webhook_id: string; event_type: string; payload: Record<string, unknown>; attempt: number; delivery_id: string
    }
    log.info(`🔄 [webhook_retry] Webhook: ${webhook_id} | Event: ${event_type} | Attempt: ${attempt + 1} | Delivery: ${delivery_id}`)

    const { retryWebhookDelivery } = await import('@/lib/webhooks/webhookEngine')
    const result = await retryWebhookDelivery(pool, { webhook_id, event_type, payload: eventPayload || {}, attempt: attempt || 0 })

    if (!result) {
      log.info(`   ⚠️ Webhook ${webhook_id} not found or inactive — skipping retry`)
      return
    }

    log.info(`   ${result.status === 'delivered' ? '✅' : result.status === 'retrying' ? '🔄' : '❌'} Status: ${result.statusCode} (${result.status}) | ${result.latencyMs}ms`)
  },

  // LDAP sync
  ldap_sync: async (payload) => {
    const { connection_id } = payload as { connection_id: string }
    log.info(`🔗 [ldap_sync] Connection: ${connection_id}`)
    // In production: use ldapjs to bind and search
    await sleep(500)
  },

  // Data retention enforcement — real deletes, respecting legal holds.
  retention_enforce: async (payload, pool) => {
    log.info(`🗑️ [retention_enforce]`, payload)
    const { runRetentionEnforcement } = await import('@/lib/enterprise/retentionJob')
    const results = await runRetentionEnforcement(pool)
    for (const r of results) {
      log.info(`   🧹 ${r.scope}: ${r.messagesDeleted} msgs, ${r.filesDeleted} files purged (cutoff ${new Date(r.cutoffMs).toISOString()})`)
    }
  },

  // Compliance export (eDiscovery) — generate artifact and store to S3.
  compliance_export: async (payload, pool) => {
    log.info(`📦 [compliance_export]`, payload)
    const { runComplianceExport } = await import('@/lib/enterprise/complianceExportJob')
    const out = await runComplianceExport(pool, payload as { export_id?: string })
    log.info(`   ✅ Export ${out.exportId}: ${out.messageCount} msgs → ${out.downloadKey} (${out.sizeBytes} bytes)`)
  },

  // File virus scan — real ClamAV INSTREAM path.
  file_scan: async (payload, pool) => {
    const { file_id } = payload as { file_id: string }
    log.info(`🔍 [file_scan] File: ${file_id}`)
    const { runFileScan } = await import('@/lib/files/fileScanJob')
    const verdict = await runFileScan(pool, payload as { file_id?: string; scan_id?: string })
    log.info(`   ${verdict.result === 'clean' ? '✅' : verdict.result === 'infected' ? '🦠' : '⏳'} verdict: ${verdict.result}${verdict.threatName ? ` (${verdict.threatName})` : ''}`)
  },

  // File content index — extract searchable text into file_index so
  // GET /api/search/files can find the upload. (Also handles the legacy
  // 'index_rebuild' jobs POST /api/search/files enqueues, which had no handler.)
  file_index: async (payload, pool) => {
    const { file_id } = payload as { file_id: string }
    log.info(`🗂️ [file_index] File: ${file_id}`)
    const { runFileIndex } = await import('@/lib/files/fileIndexJob')
    const res = await runFileIndex(pool, payload as { file_id?: string })
    log.info(`   ${res.indexed ? '✅' : '⏭️'} indexed ${res.contentLength} chars`)
  },

  // File metadata + thumbnail — backfill width/height (pure-JS sniff) and, when
  // sharp is available + media policy allows, generate a WebP thumbnail.
  file_thumbnail: async (payload, pool) => {
    const { file_id } = payload as { file_id: string }
    log.info(`🖼️ [file_thumbnail] File: ${file_id}`)
    const { runFileThumbnail } = await import('@/lib/files/thumbnailJob')
    const res = await runFileThumbnail(pool, payload as { file_id?: string })
    log.info(`   ${res.dimensionsSaved ? `✅ ${res.width}x${res.height}` : '⏭️ no dims'}${res.thumbnailSaved ? ' + thumb' : ''}`)
  },

  // Clip transcription
  clip_transcription: async (payload) => {
    const { clip_id } = payload as { clip_id: string }
    log.info(`🎙️ [clip_transcription] Clip: ${clip_id}`)
    // In production: send audio to Whisper/transcription service
    await sleep(2000)
  },

  // SCIM sync
  scim_sync: async (payload) => {
    log.info(`👥 [scim_sync]`, payload)
    await sleep(500)
  },

  // Scheduled message delivery
  scheduled_message: async (payload, pool) => {
    const { message_id } = payload as { message_id: string }
    log.info(`⏰ [scheduled_message] Message: ${message_id}`)

    // Move from scheduled_messages to messages
    const { rows } = await pool.query(
      `SELECT * FROM aaelink.scheduled_messages WHERE id = $1 AND status = 'pending'`, [message_id]
    )
    if (!rows[0]) { log.info(`   ⚠️ Already delivered or not found`); return }
    // In production: insert into messages table and broadcast via SSE
    await pool.query(`UPDATE aaelink.scheduled_messages SET status = 'sent' WHERE id = $1`, [message_id])
    log.info(`   ✅ Delivered`)
  },

  // DLP content scan — real rule matching + violation logging.
  dlp_scan: async (payload, pool) => {
    log.info(`🛡️ [dlp_scan]`, payload)
    const { runDlpScan } = await import('@/lib/enterprise/dlpScanJob')
    const res = await runDlpScan(pool, payload as {
      content?: string; message_id?: string; file_id?: string
      channel_id?: string; user_id?: string
    })
    log.info(`   ${res.clean ? '✅ clean' : `🚨 ${res.violations} violation(s) → ${res.action}`}`)
  },

  // Push notification delivery — real FCM HTTP v1 dispatch (+ APNS graceful path)
  push_deliver: async (payload, pool) => {
    const { deliverPush } = await import('@/lib/notifications/pushDelivery')
    const p = payload as Parameters<typeof deliverPush>[1]
    const target = p.user_id || (p.user_ids || []).join(',')
    log.info(`📱 [push_deliver] User: ${target} | Title: ${p.title || ''}`)
    const r = await deliverPush(pool, p)
    log.info(`   ✅ sent:${r.sent} failed:${r.failed} stale:${r.stale} apns_skipped:${r.skipped_apns}${r.no_creds ? ' (fcm_unconfigured)' : ''}`)
  },

  // Webhook v2 deliver (from webhookEmitter)
  webhook_deliver: async (payload) => {
    const { url, event_type, payload: body, signature, delivery_id } = payload as {
      url: string; event_type: string; payload: string; signature: string; delivery_id: string
    }
    log.info(`🪝 [webhook_deliver] ${event_type} → ${url} [${delivery_id?.slice(0, 8)}]`)

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'AAELink-Webhook/2.0',
          'X-AAELink-Delivery-ID': delivery_id || '',
          'X-AAELink-Event': event_type,
          'X-AAELink-Signature-256': signature || '',
        },
        body,
        signal: controller.signal,
      })
      clearTimeout(timeout)
      log.info(`   ${res.ok ? '✅' : '❌'} Status: ${res.status}`)
    } catch (err: unknown) {
      log.info(`   ❌ Delivery failed: ${err instanceof Error ? err.message : 'Unknown'}`)
      throw err // let worker retry
    }
  },

  // Events API deliver (from webhookEmitter → event_subscriptions fan-out).
  // Mirrors webhook_deliver, plus: on success bump delivery_count/last_delivery_at
  // AND reset failure_count to 0; on failure bump failure_count, auto-disable
  // runaway endpoints, then rethrow so the worker's retry/backoff machinery
  // handles redelivery. failure_count therefore tracks CONSECUTIVE failures, not
  // lifetime: a single success restarts the count so a healthy endpoint that has
  // accumulated occasional failures over months never trips the runaway disable.
  // CONTRACT MIRROR: the success/failure UPDATEs below are replicated byte-for-byte
  // (incl. FAILURE_THRESHOLD/RECENT_SUCCESS_WINDOW_MS) in the failure-semantics
  // fixtures of __tests__/api/event-subscription-dispatch.test.ts — keep both in
  // lockstep (this handler is inline + non-exported, so it cannot be imported).
  event_deliver: async (payload, pool) => {
    const { subscription_id, endpoint_url, event_type, payload: body, signature, delivery_id } = payload as {
      subscription_id: string; endpoint_url: string; event_type: string
      payload: string; signature: string; delivery_id: string
    }
    log.info(`📡 [event_deliver] ${event_type} → ${endpoint_url} [${delivery_id?.slice(0, 8)}]`)

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      const res = await fetch(endpoint_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'AAELink-Events/1.0',
          'X-AAELink-Delivery-ID': delivery_id || '',
          'X-AAELink-Event': event_type || '',
          'X-AAELink-Signature-256': signature || '',
        },
        body,
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!res.ok) {
        throw new Error(`endpoint returned ${res.status}`)
      }

      // Success: count delivery, stamp last_delivery_at, RESET failure_count to 0,
      // and clear a 'failing' status (the endpoint recovered). Resetting the count
      // makes the auto-disable threshold count CONSECUTIVE failures — a healthy
      // endpoint that has logged scattered failures over its lifetime never trips
      // the runaway disable as long as deliveries keep succeeding in between.
      await pool.query(
        `UPDATE aaelink.event_subscriptions
            SET delivery_count = delivery_count + 1,
                last_delivery_at = $2,
                failure_count = 0,
                status = CASE WHEN status = 'failing' THEN 'active' ELSE status END
          WHERE id = $1`,
        [subscription_id, Date.now()]
      )
      log.info(`   ✅ Status: ${res.status}`)
    } catch (err: unknown) {
      // Failure: bump failure_count (reset to 0 by the success path above, so this
      // counts CONSECUTIVE failures). Auto-disable a runaway endpoint (status →
      // 'failing', never hard-delete) once consecutive failures cross the threshold
      // with no recent success. We do NOT 'failing'-gate on every failure so
      // transient blips recover on their own via worker retry.
      const FAILURE_THRESHOLD = 50
      const RECENT_SUCCESS_WINDOW_MS = 24 * 60 * 60 * 1000
      await pool.query(
        `UPDATE aaelink.event_subscriptions
            SET failure_count = failure_count + 1,
                status = CASE
                  WHEN status = 'active'
                   AND failure_count + 1 >= $2
                   AND (last_delivery_at IS NULL OR last_delivery_at < $3)
                  THEN 'failing'
                  ELSE status
                END
          WHERE id = $1`,
        [subscription_id, FAILURE_THRESHOLD, Date.now() - RECENT_SUCCESS_WINDOW_MS]
      )
      log.info(`   ❌ Delivery failed: ${err instanceof Error ? err.message : 'Unknown'}`)
      throw err // let worker retry (and eventually dead-letter)
    }
  },

  // Audit log stream forward
  audit_stream: async (payload) => {
    const { destination_url, events } = payload as { destination_url: string; events: unknown[] }
    log.info(`📊 [audit_stream] ${events?.length || 0} events → ${destination_url}`)

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      await fetch(destination_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'AAELink-Audit/1.0' },
        body: JSON.stringify({ events }),
        signal: controller.signal,
      })
      clearTimeout(timeout)
      log.info(`   ✅ Streamed`)
    } catch (err: unknown) {
      log.info(`   ❌ Stream failed: ${err instanceof Error ? err.message : 'Unknown'}`)
      throw err
    }
  },

  // Workflow run — drives the execution engine (Integrations parity §30).
  // The /api/workflows execute action enqueues one of these per run. The engine
  // runs the ordered steps, records step_completed/step_failed per step, threads
  // an execution context, and finalizes the execution status. A 'delay' step
  // suspends the run: the engine returns { status: 'suspended', resumeAfterMs }
  // and we self-reschedule a continuation 'workflow_run' job (NOT a worker retry —
  // the engine already persisted the cursor, so the resume picks up the next step).
  workflow_run: async (payload, pool) => {
    const { workflow_id, execution_id } = payload as { workflow_id: string; execution_id: string }
    log.info(`⚡ [workflow_run] ${workflow_id} exec:${execution_id}`)
    if (!execution_id) throw new Error('workflow_run_missing_execution_id')

    const { runWorkflowExecution } = await import('@/lib/workflows/engine')
    const result = await runWorkflowExecution(pool, execution_id)

    if (result.status === 'suspended') {
      const { randomUUID } = await import('crypto')
      const runAfter = Date.now() + (result.resumeAfterMs || 1000)
      await pool.query(`
        INSERT INTO aaelink.jobs
          (id, type, status, priority, payload, run_after, max_retries, attempts, created_at)
        VALUES ($1, 'workflow_run', 'pending', 5, $2, $3, 3, 0, $4)
      `, [randomUUID(), JSON.stringify({ workflow_id, execution_id }), runAfter, Date.now()])
      log.info(`   ⏸️ suspended (delay); resume scheduled in ${result.resumeAfterMs}ms after ${result.stepsRun} step(s)`)
      return
    }

    // completed | failed are both terminal for the engine. A 'failed' run is a
    // business outcome already persisted on the execution row (step_failed +
    // execution failed), NOT a job error — so we do NOT throw, to avoid the worker
    // re-running the (already finalized) execution on retry.
    log.info(`   ${result.status === 'completed' ? '✅' : '❌'} ${result.status} after ${result.stepsRun} step(s)${result.error ? ` (${result.error})` : ''}`)
  },

  // Function async execution (v0.0.8)
  function_execute: async (payload, pool) => {
    const { function_id, execution_id, inputs } = payload as {
      function_id: string; execution_id: string; inputs: Record<string, unknown>
    }
    log.info(`🔧 [function_execute] fn:${function_id} exec:${execution_id}`)

    try {
      // Mark running
      await pool.query(
        `UPDATE aaelink.function_executions SET status = 'running' WHERE id = $1`,
        [execution_id]
      )

      // In production, this would dispatch to the app's function handler endpoint
      log.info(`   📨 Inputs: ${JSON.stringify(inputs).slice(0, 200)}`)

      // Mark completed
      await pool.query(
        `UPDATE aaelink.function_executions SET status = 'completed', completed_at = $1 WHERE id = $2`,
        [Date.now(), execution_id]
      )
      log.info(`   ✅ Function completed`)
    } catch (err: unknown) {
      await pool.query(
        `UPDATE aaelink.function_executions SET status = 'failed', error = $1, completed_at = $2 WHERE id = $3`,
        [err instanceof Error ? err.message : 'Unknown', Date.now(), execution_id]
      )
      throw err
    }
  },

  // Scheduled message delivery (v0.0.8 — production delivery)
  scheduled_message_deliver: async (payload, pool) => {
    const { message_id } = payload as { message_id: string }
    log.info(`📅 [scheduled_message_deliver] ${message_id}`)

    const { rows } = await pool.query<ScheduledMessageRow>(
      `SELECT * FROM aaelink.scheduled_messages WHERE id = $1 AND status = 'pending'`,
      [message_id]
    )
    if (!rows[0]) {
      log.info(`   ⏭️ Message ${message_id} not pending, skipping`)
      return
    }

    const msg = rows[0]
    const { randomUUID } = await import('crypto')
    const now = Date.now()

    // Create the actual message
    await pool.query(`
      INSERT INTO aaelink.messages (id, channel_id, user_id, content, type, root_id, created_at)
      VALUES ($1, $2, $3, $4, 'message', $5, $6)
    `, [randomUUID(), msg.channel_id, msg.user_id, msg.content, msg.root_id || null, now])

    // Mark scheduled message as delivered
    await pool.query(
      `UPDATE aaelink.scheduled_messages SET status = 'delivered' WHERE id = $1`,
      [message_id]
    )
    log.info(`   ✅ Delivered to channel ${msg.channel_id}`)
  },

  // Saved-search alerts (BLUEPRINT §2.1.4) — re-run every alerts_enabled saved
  // search as its owner, notify on new matches, advance the watermark. This is a
  // recurring heartbeat: there is no cron in this worker, so the handler
  // re-enqueues itself with run_after = now + interval (the standard
  // self-rescheduling job pattern). Seed one 'saved_search_alerts' job to start
  // the cadence (admin/jobs route or migration seed); it keeps itself alive.
  saved_search_alerts: async (payload, pool) => {
    log.info(`🔔 [saved_search_alerts] evaluating watched saved searches`)
    const { runSavedSearchAlerts } = await import('@/lib/messaging/savedSearchAlerts')
    const outcomes = await runSavedSearchAlerts(pool)
    const notified = outcomes.filter(o => o.notified).length
    const matches = outcomes.reduce((n, o) => n + o.newMatches, 0)
    log.info(`   ✅ ${outcomes.length} saved search(es), ${notified} notified, ${matches} new match(es)`)

    // Self-reschedule unless explicitly told not to (tests pass once:true to run
    // a single pass without re-arming the heartbeat).
    const once = (payload as { once?: boolean }).once === true
    if (!once) {
      const intervalMs = Number(process.env.SAVED_SEARCH_ALERTS_INTERVAL_MS) || 60_000
      const { randomUUID } = await import('crypto')
      // Idempotent re-arm: only insert when no pending 'saved_search_alerts' row
      // already exists. The reschedule INSERT and the status='completed' UPDATE are
      // not in one txn, so a crash-retry between them would otherwise double-arm the
      // heartbeat (duplicate notifications). One-pending-per-type makes it safe.
      await pool.query(
        `INSERT INTO aaelink.jobs
           (id, type, status, priority, payload, run_after, max_retries, attempts, created_at)
         SELECT $1, 'saved_search_alerts', 'pending', 3, '{}', $2, 3, 0, $3
          WHERE NOT EXISTS (
            SELECT 1 FROM aaelink.jobs WHERE type = 'saved_search_alerts' AND status = 'pending'
          )`,
        [randomUUID(), Date.now() + intervalMs, Date.now()]
      )
    }
  },

  // Missed-activity email digests (Notifications parity). Recurring heartbeat,
  // same self-rescheduling pattern as saved_search_alerts: collect each due
  // user's unread since-watermark notifications, send a summary via the SMTP
  // sender (no-op when unconfigured), advance the watermark, then re-arm. Seed
  // one 'email_digest' job to start the cadence; it keeps itself alive.
  email_digest: async (payload, pool) => {
    log.info(`📧 [email_digest] composing missed-activity digests`)
    const { runEmailDigests } = await import('@/lib/notifications/emailDigest')
    const res = await runEmailDigests(pool)
    log.info(`   ✅ considered:${res.considered} sent:${res.sent} empty:${res.skipped_empty} watermarks:${res.watermarks_advanced}`)

    // Self-reschedule unless explicitly told not to (tests pass once:true).
    const once = (payload as { once?: boolean }).once === true
    if (!once) {
      const intervalMs = Number(process.env.EMAIL_DIGEST_INTERVAL_MS) || 15 * 60_000
      const { randomUUID } = await import('crypto')
      // Idempotent re-arm (see saved_search_alerts above): one pending 'email_digest'
      // row at a time, so a crash between this INSERT and the completion UPDATE can't
      // double-arm and double-send digests.
      await pool.query(
        `INSERT INTO aaelink.jobs
           (id, type, status, priority, payload, run_after, max_retries, attempts, created_at)
         SELECT $1, 'email_digest', 'pending', 3, '{}', $2, 3, 0, $3
          WHERE NOT EXISTS (
            SELECT 1 FROM aaelink.jobs WHERE type = 'email_digest' AND status = 'pending'
          )`,
        [randomUUID(), Date.now() + intervalMs, Date.now()]
      )
    }
  },

  // Resumable upload-session sweep (Files parity). Recurring heartbeat, same
  // self-rescheduling pattern as saved_search_alerts/email_digest: expire +
  // clean stale 'active' upload sessions past their 24h TTL (abort the S3
  // multipart / unlink the local partial), then re-arm. Seeded once in
  // migration 040; it keeps itself alive here.
  upload_session_sweep: async (payload, pool) => {
    log.info(`🧹 [upload_session_sweep] sweeping expired upload sessions`)
    const { sweepExpiredUploadSessions } = await import('@/lib/files/uploadSessions')
    const expired = await sweepExpiredUploadSessions(pool)
    log.info(`   ✅ expired ${expired} stale upload session(s)`)

    // Self-reschedule unless explicitly told not to (tests pass once:true).
    const once = (payload as { once?: boolean }).once === true
    if (!once) {
      const intervalMs = Number(process.env.UPLOAD_SESSION_SWEEP_INTERVAL_MS) || 60 * 60_000
      const { randomUUID } = await import('crypto')
      // Idempotent re-arm (see saved_search_alerts): one pending row at a time
      // so a crash between this INSERT and the completion UPDATE can't double-arm.
      await pool.query(
        `INSERT INTO aaelink.jobs
           (id, type, status, priority, payload, run_after, max_retries, attempts, created_at)
         SELECT $1, 'upload_session_sweep', 'pending', 2, '{}', $2, 3, 0, $3
          WHERE NOT EXISTS (
            SELECT 1 FROM aaelink.jobs WHERE type = 'upload_session_sweep' AND status = 'pending'
          )`,
        [randomUUID(), Date.now() + intervalMs, Date.now()]
      )
    }
  },

  // OAuth token cleanup (v0.0.8 — expire old tokens)
  oauth_token_cleanup: async (_payload, pool) => {
    log.info(`🔑 [oauth_token_cleanup] Removing expired tokens`)
    const now = Date.now()
    // Prune predicates live in lib/auth/oauthCleanup.ts so they are unit-testable
    // (the handlers map here is module-local and not exported).
    const tokenCount = await pruneExpiredOAuthTokens(pool, now)
    log.info(`   ✅ Removed ${tokenCount} expired tokens`)
    const codeCount = await pruneOAuthCodes(pool, now)
    log.info(`   ✅ Removed ${codeCount} expired/consumed authorization codes`)
  },

  // Guest account expiry (Admin parity 29). Recurring heartbeat, same
  // self-rescheduling pattern as saved_search_alerts/email_digest/upload_session_sweep:
  // find guests past expires_at and run the SHARED revoke path the manual
  // DELETE /api/admin/guests handler uses (lib/comms/guestAccounts), which drops
  // channel + workspace membership AND kills live sessions, then re-arm. Seeded
  // once in migration 049; it keeps itself alive here. Idempotent — an
  // already-revoked guest is skipped, so a crash-retry double-runs harmlessly.
  guest_expire: async (payload, pool) => {
    log.info(`🕓 [guest_expire] revoking expired guest accounts`)
    const { runGuestExpiry } = await import('@/lib/comms/guestAccounts')
    const res = await runGuestExpiry(pool)
    log.info(`   ✅ considered:${res.considered} revoked:${res.revoked}`)

    // Self-reschedule unless explicitly told not to (tests pass once:true to run
    // a single pass without re-arming the heartbeat).
    const once = (payload as { once?: boolean }).once === true
    if (!once) {
      const intervalMs = Number(process.env.GUEST_EXPIRE_INTERVAL_MS) || 60 * 60_000
      const { randomUUID } = await import('crypto')
      // Idempotent re-arm (see saved_search_alerts): one pending row at a time
      // so a crash between this INSERT and the completion UPDATE can't double-arm.
      await pool.query(
        `INSERT INTO aaelink.jobs
           (id, type, status, priority, payload, run_after, max_retries, attempts, created_at)
         SELECT $1, 'guest_expire', 'pending', 2, '{}', $2, 3, 0, $3
          WHERE NOT EXISTS (
            SELECT 1 FROM aaelink.jobs WHERE type = 'guest_expire' AND status = 'pending'
          )`,
        [randomUUID(), Date.now() + intervalMs, Date.now()]
      )
    }
  },
}

// Legacy alias: POST /api/search/files enqueues 'index_rebuild' jobs (no handler
// existed before Stage B). Route them to the file_index handler.
handlers.index_rebuild = handlers.file_index

// Legacy alias: the pre-engine stub enqueued 'workflow_execute' jobs. Route any
// in-flight ones to the real engine-driven 'workflow_run' handler.
handlers.workflow_execute = handlers.workflow_run

// ── Worker Engine ────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function claimJob(pool: Pool): Promise<JobRow | null> {
  // Atomic claim: grab one pending job that's ready to run
  const { rows } = await pool.query<JobRow>(`
    UPDATE aaelink.jobs SET status = 'running'
    WHERE id = (
      SELECT id FROM aaelink.jobs
      WHERE status = 'pending' AND run_after <= $1
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `, [Date.now()])

  return rows[0] || null
}

async function processJob(job: JobRow, pool: Pool) {
  const jobId = String(job.id)
  const jobType = String(job.type)
  const attempts = Number(job.attempts || 0) + 1
  const maxRetries = Number(job.max_retries || 3)

  let payload: JobPayload = {}
  try { payload = JSON.parse(String(job.payload || '{}')) } catch { /**/ }

  const handler = handlers[jobType]
  if (!handler) {
    log.info(`⚠️ No handler for job type: ${jobType}`)
    await pool.query(`UPDATE aaelink.jobs SET status = 'failed', attempts = $1 WHERE id = $2`, [attempts, jobId])
    return
  }

  const start = Date.now()
  try {
    await handler(payload, pool)
    const duration = Date.now() - start
    await pool.query(
      `UPDATE aaelink.jobs SET status = 'completed', attempts = $1 WHERE id = $2`,
      [attempts, jobId]
    )
    log.info(`   ✅ ${jobType} completed in ${duration}ms`)
  } catch (err: unknown) {
    const duration = Date.now() - start
    const errMsg = err instanceof Error ? err.message : 'Unknown error'

    if (attempts >= maxRetries) {
      await pool.query(
        `UPDATE aaelink.jobs SET status = 'failed', attempts = $1 WHERE id = $2`,
        [attempts, jobId]
      )
      log.info(`   💀 ${jobType} failed permanently after ${attempts} attempts (${duration}ms): ${errMsg}`)
    } else {
      // Exponential backoff
      const retryDelay = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempts - 1)
      await pool.query(
        `UPDATE aaelink.jobs SET status = 'pending', attempts = $1, run_after = $2 WHERE id = $3`,
        [attempts, Date.now() + retryDelay, jobId]
      )
      log.info(`   🔄 ${jobType} will retry in ${retryDelay}ms (attempt ${attempts}/${maxRetries}): ${errMsg}`)
    }
  }
}

// ── Main Loop ────────────────────────────────────────────────────────

async function main() {
  log.info(`
╔═══════════════════════════════════════════════╗
║          AAELink Background Worker            ║
║                                               ║
║  Concurrency:  ${String(CONCURRENCY).padEnd(30)}║
║  Poll interval: ${String(POLL_INTERVAL_MS + 'ms').padEnd(29)}║
║  Job types:    ${String(Object.keys(handlers).length).padEnd(30)}║
╚═══════════════════════════════════════════════╝
  `)

  const pool = resolvePool()

  // Verify connection
  try {
    await pool.query('SELECT 1')
    log.info('✅ Database connected')
  } catch (err: unknown) {
    log.error('database connection failed', { name: 'worker.boot', error: err instanceof Error ? err.message : String(err) })
    process.exit(1)
  }

  // Poll loop
  while (running) {
    try {
      while (activeJobs < CONCURRENCY) {
        const job = await claimJob(pool)
        if (!job) break // No more jobs

        activeJobs++
        const jobType = String(job.type)
        const jobId = String(job.id).slice(0, 8)
        log.info(`\n📋 Processing ${jobType} [${jobId}...]`)

        // Process async (non-blocking)
        processJob(job, pool)
          .catch(err => log.error('unhandled error in job', { name: 'worker.dispatch', error: err instanceof Error ? err.message : String(err) }))
          .finally(() => { activeJobs-- })
      }
    } catch (err: unknown) {
      log.error('worker poll error', { name: 'worker.poll', error: err instanceof Error ? err.message : String(err) })
    }

    await sleep(POLL_INTERVAL_MS)
  }

  log.info('\n⏹️ Shutting down... waiting for active jobs')
  // Wait for active jobs to finish (max 30s)
  const deadline = Date.now() + 30000
  while (activeJobs > 0 && Date.now() < deadline) {
    await sleep(500)
  }

  // Do NOT call pool.end() here — the pool is the singleton from `lib/db.ts`,
  // shared with API routes co-located in the same process. Closing it would
  // poison the API. The pool is closed when the process exits.
  log.info('👋 Worker stopped')
  process.exit(0)
}

// ── Graceful Shutdown ────────────────────────────────────────────────

process.on('SIGTERM', () => { log.info('\n📢 SIGTERM received'); running = false })
process.on('SIGINT', () => { log.info('\n📢 SIGINT received'); running = false })

main().catch(err => {
  log.error('worker fatal', { name: 'worker.main', error: err instanceof Error ? err.message : String(err) })
  process.exit(1)
})
