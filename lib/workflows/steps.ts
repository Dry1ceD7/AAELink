/**
 * Workflow step executors (Integrations parity §30).
 *
 * Each executor runs ONE step type against a live execution context and returns
 * either an output bag (merged into the context for later steps) or a control
 * signal. Supported REAL step types (drawn from workflow_steps.type + .config):
 *
 *   post_message — create a message via the real messages table + emit realtime
 *                  through redisPubSub (never a raw notifications INSERT).
 *   call_webhook — sign + POST a payload using the same HMAC scheme as the
 *                  webhook emitter (sha256=<hex over the JSON body>).
 *   delay        — suspend the run; the engine reschedules a worker continuation.
 *   conditional  — branch on a simple predicate over the execution context.
 *
 * Step config is interpolated against the running context so a later step can use
 * an earlier step's output (e.g. "{{steps.0.message_id}}").
 */
import { randomUUID, createHmac } from 'crypto'
import type { Pool } from 'pg'
import { getPubSub, channelTopic } from '@/lib/realtime/redisPubSub'

export interface StepContext {
  execution_id: string
  workflow_id: string
  triggered_by: string
  /** Outputs of prior steps keyed by position, plus the trigger input bag. */
  vars: Record<string, unknown>
}

export type StepResult =
  | { kind: 'output'; output: Record<string, unknown> }
  | { kind: 'delay'; resumeAfterMs: number }

/** Resolve "{{path.to.value}}" tokens in a string against the context vars. */
export function interpolate(value: unknown, vars: Record<string, unknown>): unknown {
  if (typeof value !== 'string') return value
  return value.replace(/\{\{\s*([\w.[\]]+)\s*\}\}/g, (_m, path: string) => {
    const resolved = readPath(vars, path)
    return resolved === undefined || resolved === null ? '' : String(resolved)
  })
}

function readPath(root: unknown, path: string): unknown {
  const parts = path.replace(/\[(\w+)\]/g, '.$1').split('.').filter(Boolean)
  let cur: unknown = root
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

function asString(v: unknown): string { return typeof v === 'string' ? v : v == null ? '' : String(v) }

/** post_message: insert a real message row + fan out via redisPubSub. */
export async function runPostMessage(
  pool: Pool,
  cfg: Record<string, unknown>,
  ctx: StepContext
): Promise<StepResult> {
  const channelId = asString(interpolate(cfg.channel_id, ctx.vars))
  const text = asString(interpolate(cfg.text ?? cfg.message, ctx.vars))
  if (!channelId) throw new Error('post_message_missing_channel')
  if (!text) throw new Error('post_message_missing_text')

  const userId = asString(cfg.user_id) || ctx.triggered_by
  const id = randomUUID()
  const now = Date.now()
  await pool.query(
    `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '', $5, $5)`,
    [id, channelId, userId, text, now]
  )
  // Realtime emit goes through redisPubSub ONLY (Hard Rule #6).
  try {
    await getPubSub().publish(channelTopic(channelId), {
      type: 'message',
      channel_id: channelId,
      payload: { id, channel_id: channelId, user_id: userId, body: text, created_at: now },
    })
  } catch { /* realtime best-effort: a broker blip must not fail the step */ }

  return { kind: 'output', output: { message_id: id, channel_id: channelId } }
}

/** call_webhook: signed POST mirroring lib/webhooks/webhookEmitter.signPayload. */
export async function runCallWebhook(
  cfg: Record<string, unknown>,
  ctx: StepContext
): Promise<StepResult> {
  const url = asString(interpolate(cfg.url, ctx.vars))
  if (!/^https?:\/\//.test(url)) throw new Error('call_webhook_invalid_url')
  const secret = asString(cfg.secret)
  const bodyObj = (cfg.body && typeof cfg.body === 'object')
    ? JSON.parse(asString(interpolate(JSON.stringify(cfg.body), ctx.vars)))
    : { execution_id: ctx.execution_id, workflow_id: ctx.workflow_id }
  const payload = JSON.stringify(bodyObj)
  const signature = secret
    ? `sha256=${createHmac('sha256', secret).update(payload, 'utf8').digest('hex')}`
    : ''

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'AAELink-Workflow/1.0',
        'X-AAELink-Signature-256': signature,
      },
      body: payload,
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`call_webhook_status_${res.status}`)
    return { kind: 'output', output: { status: res.status, ok: true } }
  } finally {
    clearTimeout(timeout)
  }
}

/** delay: suspend the run and signal the engine to reschedule a continuation. */
export function runDelay(cfg: Record<string, unknown>): StepResult {
  let raw = Number(cfg.ms ?? cfg.delay_ms)
  if (!Number.isFinite(raw) && cfg.seconds != null) raw = Number(cfg.seconds) * 1000
  const ms = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 24 * 60 * 60 * 1000) : 1000
  return { kind: 'delay', resumeAfterMs: ms }
}

/**
 * conditional: evaluate a simple predicate over the context. Supported ops:
 * eq, ne, gt, lt, exists, truthy. On false the step is recorded 'skipped' and
 * (when cfg.halt_on_false) the workflow stops gracefully as completed.
 */
export function evalConditional(
  cfg: Record<string, unknown>,
  vars: Record<string, unknown>
): { passed: boolean; halt: boolean } {
  const left = interpolate(cfg.left ?? `{{${asString(cfg.field)}}}`, vars)
  const op = asString(cfg.op || 'truthy')
  const right = interpolate(cfg.right ?? cfg.value, vars)
  let passed = false
  switch (op) {
    case 'eq': passed = asString(left) === asString(right); break
    case 'ne': passed = asString(left) !== asString(right); break
    case 'gt': passed = Number(left) > Number(right); break
    case 'lt': passed = Number(left) < Number(right); break
    case 'exists': passed = left !== undefined && left !== null && asString(left) !== ''; break
    case 'truthy':
    default: passed = Boolean(left) && asString(left) !== 'false' && asString(left) !== '0'; break
  }
  return { passed, halt: !passed && Boolean(cfg.halt_on_false) }
}
