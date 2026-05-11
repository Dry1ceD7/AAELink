/**
 * Structured Logger for AAELink
 *
 * Provides request-scoped logging with trace IDs and metrics integration.
 * Every log entry includes: timestamp, level, trace_id, route, user_id, duration.
 *
 * Usage:
 *   import { createRequestLogger } from '@/lib/logger'
 *
 *   const log = createRequestLogger(req, '/api/channels')
 *   log.info('Channel created', { channel_id: '...', name: '...' })
 *   log.error('Failed to create channel', { error: err.message })
 *   log.finish(201)  // logs final request summary + records metrics
 */

import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { httpRequests, httpLatency } from '@/lib/metrics'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  timestamp: string
  level: LogLevel
  trace_id: string
  route: string
  method: string
  user_id?: string
  message: string
  data?: Record<string, unknown>
  duration_ms?: number
}

export interface RequestLogger {
  traceId: string
  debug: (message: string, data?: Record<string, unknown>) => void
  info: (message: string, data?: Record<string, unknown>) => void
  warn: (message: string, data?: Record<string, unknown>) => void
  error: (message: string, data?: Record<string, unknown>) => void
  /** Call at the end of request handling to log summary + record metrics */
  finish: (statusCode: number) => void
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const MIN_LOG_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info'

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[MIN_LOG_LEVEL]
}

function formatLog(entry: LogEntry): string {
  const { timestamp, level, trace_id, route, method, user_id, message, data, duration_ms } = entry
  const parts = [
    `[${timestamp}]`,
    level.toUpperCase().padEnd(5),
    `[${trace_id.slice(0, 8)}]`,
    `${method} ${route}`,
  ]
  if (user_id) parts.push(`uid=${user_id.slice(0, 8)}`)
  if (duration_ms !== undefined) parts.push(`${duration_ms}ms`)
  parts.push(message)
  if (data && Object.keys(data).length > 0) {
    parts.push(JSON.stringify(data))
  }
  return parts.join(' ')
}

/**
 * Create a request-scoped logger.
 *
 * @param req - NextRequest (for extracting trace ID from headers)
 * @param route - API route path (e.g. '/api/channels')
 * @param userId - Optional authenticated user ID
 */
export function createRequestLogger(
  req: NextRequest,
  route: string,
  userId?: string
): RequestLogger {
  // Use existing trace ID from header or generate new one
  const traceId = req.headers.get('x-trace-id')
    || req.headers.get('x-request-id')
    || randomUUID()

  const method = req.method
  const startTime = performance.now()

  function log(level: LogLevel, message: string, data?: Record<string, unknown>) {
    if (!shouldLog(level)) return

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      trace_id: traceId,
      route,
      method,
      user_id: userId,
      message,
      data,
    }

    const formatted = formatLog(entry)

    switch (level) {
      case 'error': console.error(formatted); break
      case 'warn': console.warn(formatted); break
      case 'debug': console.debug(formatted); break
      default: console.log(formatted)
    }
  }

  return {
    traceId,
    debug: (msg, data) => log('debug', msg, data),
    info: (msg, data) => log('info', msg, data),
    warn: (msg, data) => log('warn', msg, data),
    error: (msg, data) => log('error', msg, data),
    finish: (statusCode: number) => {
      const duration = Math.round(performance.now() - startTime)

      // Record metrics
      httpRequests.inc({ method, route, status: String(statusCode) })
      httpLatency.observe({ route }, duration)

      // Log request summary
      const level: LogLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info'
      log(level, `${statusCode} completed`, { duration_ms: duration, status: statusCode })
    },
  }
}

/**
 * Generate a trace ID for propagation to downstream services.
 */
export function generateTraceId(): string {
  return randomUUID()
}

/**
 * Extract trace ID from a request (header or generate new).
 */
export function getTraceId(req: NextRequest): string {
  return req.headers.get('x-trace-id')
    || req.headers.get('x-request-id')
    || generateTraceId()
}
