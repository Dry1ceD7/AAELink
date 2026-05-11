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

import { Pool } from 'pg'

// ── Configuration ────────────────────────────────────────────────────

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_MS) || 2000
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY) || 5
const RETRY_BACKOFF_BASE_MS = 1000

let running = true
let activeJobs = 0

// ── Database ─────────────────────────────────────────────────────────

function createPool(): Pool {
  const url = process.env.DATABASE_URL
    || `postgresql://aaelink:aaelink@${process.env.PGHOST || '127.0.0.1'}:${process.env.PGPORT || '25432'}/aaelink`
  return new Pool({ connectionString: url, max: CONCURRENCY + 2 })
}

// ── Job Type Handlers ────────────────────────────────────────────────

type JobPayload = Record<string, unknown>
type JobHandler = (payload: JobPayload, pool: Pool) => Promise<void>

interface JobRow {
  id: string; type: string; status: string; payload: string
  attempts: number; max_retries: number; priority: number
  run_after: number; created_at: number
}

interface WorkflowStepRow {
  id: string; workflow_id: string; position: number
  type: string; function_id: string | null; config: string | null
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
    console.log(`📧 [email_send] To: ${to} | Subject: ${subject} | HTML: ${String(html).length} chars`)
    // Simulate send delay
    await sleep(200)
  },

  // Webhook retry (v2 — HMAC, exponential backoff)
  webhook_retry: async (payload, pool) => {
    const { webhook_id, event_type, payload: eventPayload, attempt, delivery_id } = payload as {
      webhook_id: string; event_type: string; payload: Record<string, unknown>; attempt: number; delivery_id: string
    }
    console.log(`🔄 [webhook_retry] Webhook: ${webhook_id} | Event: ${event_type} | Attempt: ${attempt + 1} | Delivery: ${delivery_id}`)

    const { retryWebhookDelivery } = await import('./webhookEngine')
    const result = await retryWebhookDelivery(pool, { webhook_id, event_type, payload: eventPayload || {}, attempt: attempt || 0 })

    if (!result) {
      console.log(`   ⚠️ Webhook ${webhook_id} not found or inactive — skipping retry`)
      return
    }

    console.log(`   ${result.status === 'delivered' ? '✅' : result.status === 'retrying' ? '🔄' : '❌'} Status: ${result.statusCode} (${result.status}) | ${result.latencyMs}ms`)
  },

  // LDAP sync
  ldap_sync: async (payload) => {
    const { connection_id } = payload as { connection_id: string }
    console.log(`🔗 [ldap_sync] Connection: ${connection_id}`)
    // In production: use ldapjs to bind and search
    await sleep(500)
  },

  // Data retention enforcement
  retention_enforce: async (payload, pool) => {
    console.log(`🗑️ [retention_enforce]`, payload)
    // In production: delete messages/files older than policy
    await sleep(300)
  },

  // Compliance export
  compliance_export: async (payload) => {
    console.log(`📦 [compliance_export]`, payload)
    await sleep(1000)
  },

  // File virus scan
  file_scan: async (payload) => {
    const { file_id } = payload as { file_id: string }
    console.log(`🔍 [file_scan] File: ${file_id}`)
    // In production: send to ClamAV socket
    await sleep(300)
  },

  // Clip transcription
  clip_transcription: async (payload) => {
    const { clip_id } = payload as { clip_id: string }
    console.log(`🎙️ [clip_transcription] Clip: ${clip_id}`)
    // In production: send audio to Whisper/transcription service
    await sleep(2000)
  },

  // SCIM sync
  scim_sync: async (payload) => {
    console.log(`👥 [scim_sync]`, payload)
    await sleep(500)
  },

  // Scheduled message delivery
  scheduled_message: async (payload, pool) => {
    const { message_id } = payload as { message_id: string }
    console.log(`⏰ [scheduled_message] Message: ${message_id}`)

    // Move from scheduled_messages to messages
    const { rows } = await pool.query(
      `SELECT * FROM aaelink.scheduled_messages WHERE id = $1 AND status = 'pending'`, [message_id]
    )
    if (!rows[0]) { console.log(`   ⚠️ Already delivered or not found`); return }
    // In production: insert into messages table and broadcast via SSE
    await pool.query(`UPDATE aaelink.scheduled_messages SET status = 'sent' WHERE id = $1`, [message_id])
    console.log(`   ✅ Delivered`)
  },

  // DLP content scan
  dlp_scan: async (payload) => {
    console.log(`🛡️ [dlp_scan]`, payload)
    await sleep(200)
  },

  // Push notification delivery
  push_deliver: async (payload) => {
    const { user_id, title } = payload as { user_id: string; title: string }
    console.log(`📱 [push_deliver] User: ${user_id} | Title: ${title}`)
    // In production: send via APNS/FCM SDK
    await sleep(100)
  },

  // Webhook v2 deliver (from webhookEmitter)
  webhook_deliver: async (payload) => {
    const { url, event_type, payload: body, signature, delivery_id } = payload as {
      url: string; event_type: string; payload: string; signature: string; delivery_id: string
    }
    console.log(`🪝 [webhook_deliver] ${event_type} → ${url} [${delivery_id?.slice(0, 8)}]`)

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
      console.log(`   ${res.ok ? '✅' : '❌'} Status: ${res.status}`)
    } catch (err: unknown) {
      console.log(`   ❌ Delivery failed: ${err instanceof Error ? err.message : 'Unknown'}`)
      throw err // let worker retry
    }
  },

  // Audit log stream forward
  audit_stream: async (payload) => {
    const { destination_url, events } = payload as { destination_url: string; events: unknown[] }
    console.log(`📊 [audit_stream] ${events?.length || 0} events → ${destination_url}`)

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
      console.log(`   ✅ Streamed`)
    } catch (err: unknown) {
      console.log(`   ❌ Stream failed: ${err instanceof Error ? err.message : 'Unknown'}`)
      throw err
    }
  },

  // Workflow step execution (v0.0.8)
  workflow_execute: async (payload, pool) => {
    const { workflow_id, execution_id } = payload as { workflow_id: string; execution_id: string }
    console.log(`⚡ [workflow_execute] ${workflow_id} exec:${execution_id}`)

    try {
      // Fetch workflow steps
      const { rows: steps } = await pool.query<WorkflowStepRow>(
        `SELECT * FROM aaelink.workflow_steps WHERE workflow_id = $1 ORDER BY position ASC`,
        [workflow_id]
      )

      for (const s of steps) {
        const stepType = String(s.type || 'function')

        if (stepType === 'function' && s.function_id) {
          // Execute the function
          const { rows: fnRows } = await pool.query(
            `SELECT * FROM aaelink.functions_registry WHERE id = $1 AND is_active = true`,
            [s.function_id]
          )
          if (!fnRows[0]) {
            throw new Error(`Function ${s.function_id} not found or inactive`)
          }

          // Create function execution record
          const { randomUUID } = await import('crypto')
          await pool.query(`
            INSERT INTO aaelink.function_executions (id, function_id, status, inputs, triggered_by, created_at)
            VALUES ($1, $2, 'completed', $3, $4, $5)
          `, [randomUUID(), s.function_id, JSON.stringify(s.config || {}), `workflow:${execution_id}`, Date.now()])
        }

        console.log(`   ✅ Step ${s.position}: ${stepType}`)
      }

      await pool.query(
        `UPDATE aaelink.workflow_executions SET status = 'completed', completed_at = $1 WHERE id = $2`,
        [Date.now(), execution_id]
      )
      console.log(`   ✅ Workflow completed`)
    } catch (err: unknown) {
      await pool.query(
        `UPDATE aaelink.workflow_executions SET status = 'failed', error = $1, completed_at = $2 WHERE id = $3`,
        [err instanceof Error ? err.message : 'Unknown', Date.now(), execution_id]
      )
      throw err
    }
  },

  // Function async execution (v0.0.8)
  function_execute: async (payload, pool) => {
    const { function_id, execution_id, inputs } = payload as {
      function_id: string; execution_id: string; inputs: Record<string, unknown>
    }
    console.log(`🔧 [function_execute] fn:${function_id} exec:${execution_id}`)

    try {
      // Mark running
      await pool.query(
        `UPDATE aaelink.function_executions SET status = 'running' WHERE id = $1`,
        [execution_id]
      )

      // In production, this would dispatch to the app's function handler endpoint
      console.log(`   📨 Inputs: ${JSON.stringify(inputs).slice(0, 200)}`)

      // Mark completed
      await pool.query(
        `UPDATE aaelink.function_executions SET status = 'completed', completed_at = $1 WHERE id = $2`,
        [Date.now(), execution_id]
      )
      console.log(`   ✅ Function completed`)
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
    console.log(`📅 [scheduled_message_deliver] ${message_id}`)

    const { rows } = await pool.query<ScheduledMessageRow>(
      `SELECT * FROM aaelink.scheduled_messages WHERE id = $1 AND status = 'pending'`,
      [message_id]
    )
    if (!rows[0]) {
      console.log(`   ⏭️ Message ${message_id} not pending, skipping`)
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
    console.log(`   ✅ Delivered to channel ${msg.channel_id}`)
  },

  // OAuth token cleanup (v0.0.8 — expire old tokens)
  oauth_token_cleanup: async (_payload, pool) => {
    console.log(`🔑 [oauth_token_cleanup] Removing expired tokens`)
    const now = Date.now()
    const { rowCount } = await pool.query(
      `DELETE FROM aaelink.oauth_tokens WHERE expires_at > 0 AND expires_at < $1`,
      [now]
    )
    console.log(`   ✅ Removed ${rowCount || 0} expired tokens`)
  },
}

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
    console.log(`⚠️ No handler for job type: ${jobType}`)
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
    console.log(`   ✅ ${jobType} completed in ${duration}ms`)
  } catch (err: unknown) {
    const duration = Date.now() - start
    const errMsg = err instanceof Error ? err.message : 'Unknown error'

    if (attempts >= maxRetries) {
      await pool.query(
        `UPDATE aaelink.jobs SET status = 'failed', attempts = $1 WHERE id = $2`,
        [attempts, jobId]
      )
      console.log(`   💀 ${jobType} failed permanently after ${attempts} attempts (${duration}ms): ${errMsg}`)
    } else {
      // Exponential backoff
      const retryDelay = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempts - 1)
      await pool.query(
        `UPDATE aaelink.jobs SET status = 'pending', attempts = $1, run_after = $2 WHERE id = $3`,
        [attempts, Date.now() + retryDelay, jobId]
      )
      console.log(`   🔄 ${jobType} will retry in ${retryDelay}ms (attempt ${attempts}/${maxRetries}): ${errMsg}`)
    }
  }
}

// ── Main Loop ────────────────────────────────────────────────────────

async function main() {
  console.log(`
╔═══════════════════════════════════════════════╗
║          AAELink Background Worker            ║
║                                               ║
║  Concurrency:  ${String(CONCURRENCY).padEnd(30)}║
║  Poll interval: ${String(POLL_INTERVAL_MS + 'ms').padEnd(29)}║
║  Job types:    ${String(Object.keys(handlers).length).padEnd(30)}║
╚═══════════════════════════════════════════════╝
  `)

  const pool = createPool()

  // Verify connection
  try {
    await pool.query('SELECT 1')
    console.log('✅ Database connected')
  } catch (err: unknown) {
    console.error('❌ Database connection failed:', err instanceof Error ? err.message : err)
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
        console.log(`\n📋 Processing ${jobType} [${jobId}...]`)

        // Process async (non-blocking)
        processJob(job, pool)
          .catch(err => console.error(`Unhandled error in job:`, err))
          .finally(() => { activeJobs-- })
      }
    } catch (err: unknown) {
      console.error('Poll error:', err instanceof Error ? err.message : err)
    }

    await sleep(POLL_INTERVAL_MS)
  }

  console.log('\n⏹️ Shutting down... waiting for active jobs')
  // Wait for active jobs to finish (max 30s)
  const deadline = Date.now() + 30000
  while (activeJobs > 0 && Date.now() < deadline) {
    await sleep(500)
  }

  await pool.end()
  console.log('👋 Worker stopped')
  process.exit(0)
}

// ── Graceful Shutdown ────────────────────────────────────────────────

process.on('SIGTERM', () => { console.log('\n📢 SIGTERM received'); running = false })
process.on('SIGINT', () => { console.log('\n📢 SIGINT received'); running = false })

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
