/**
 * `lib/log.ts` — central process-scoped logger for AAELink (v0.0.43).
 *
 * **Two loggers in this codebase:**
 *
 *   1. `lib/log.ts` (this file) — process-scoped. Use for module-level logs
 *      that are not tied to a single HTTP request (worker tasks, the WS
 *      gateway, schema migrations, background jobs, lib-level errors).
 *   2. `lib/logger.ts` — request-scoped, attaches a trace id and finishes by
 *      recording HTTP metrics. Use inside route handlers via
 *      `createRequestLogger(req, route, userId?)`.
 *
 * Both share the same `LOG_LEVEL` env var and emit to stdout, so they
 * interleave cleanly under any log shipper.
 *
 * Replaces ad-hoc `console.log/warn/error/info` callsites across the codebase
 * with a single typed logger that:
 *
 *   • Respects `LOG_LEVEL` (`debug` | `info` | `warn` | `error` | `silent`).
 *     Default `info` in production; `debug` in development.
 *   • Emits **structured JSON** in production (one line per entry — friendly
 *     to log shippers like Vector/Filebeat/Loki).
 *   • Emits **pretty-printed, colorless** lines in development.
 *   • Adds a `name` field for the call-site (typed; encourages each caller to
 *     pass a stable identifier instead of free-form prefixes).
 *
 * The contract is intentionally tiny — no `child()` factories, no transports,
 * no formatter plugins. If we need more, swap to `pino` later; the call sites
 * stay the same.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
}

function resolveLevel(): LogLevel {
  const raw = (typeof process !== 'undefined' ? process.env.LOG_LEVEL : '')?.toLowerCase()
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error' || raw === 'silent') {
    return raw
  }
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') return 'info'
  return 'debug'
}

const ACTIVE_LEVEL_RANK = LEVEL_RANK[resolveLevel()]
const IS_PRODUCTION = typeof process !== 'undefined' && process.env.NODE_ENV === 'production'

interface LogFields {
  /** Stable call-site identifier — e.g., `realtime.connectCollab`. */
  name?: string
  [k: string]: unknown
}

function emit(level: Exclude<LogLevel, 'silent'>, message: string, fields?: LogFields): void {
  if (LEVEL_RANK[level] < ACTIVE_LEVEL_RANK) return
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(fields ?? {}),
  }
  if (IS_PRODUCTION) {
    // One JSON line per entry — the canonical format for log shippers.
    process.stdout.write(JSON.stringify(entry) + '\n')
  } else {
    // Dev: prefix the level + name, then the message. Fields appended only
    // when present so quick eyeballing isn't noisy.
    const tag = `[${level}${fields?.name ? `:${fields.name}` : ''}]`
    const detail = fields && Object.keys(fields).filter(k => k !== 'name').length > 0
      ? ' ' + JSON.stringify({ ...fields, name: undefined })
      : ''
    // Use the matching console method so devtools group/filter still work.
    // eslint-disable-next-line no-console -- the only legit console use
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
    fn(`${tag} ${message}${detail}`)
  }
}

export const log = {
  debug: (message: string, fields?: LogFields) => emit('debug', message, fields),
  info: (message: string, fields?: LogFields) => emit('info', message, fields),
  warn: (message: string, fields?: LogFields) => emit('warn', message, fields),
  error: (message: string, fields?: LogFields) => emit('error', message, fields),
}

export type { LogLevel, LogFields }
