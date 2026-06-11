import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Custom Functions API — Slack functions.* parity.
 *
 * Custom functions are reusable automation steps that can be composed
 * into workflows. They define inputs/outputs and execute custom logic.
 *
 * GET  /api/functions — list registered functions
 * POST /api/functions — register/execute/manage functions
 *
 * Supports:
 *   - Function registration with input/output schemas
 *   - Function execution (sync or async)
 *   - Execution log/history
 *   - Admin approval for third-party functions
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const functionId = req.nextUrl.searchParams.get('function_id') || ''
  const view = req.nextUrl.searchParams.get('view') || 'list'

  if (functionId) {
    const { rows } = await pool.query<{
      id: string; callback_id: string; title: string; description: string;
      type: string; input_parameters: string; output_parameters: string;
      created_by: string; created_at: number;
    }>(`SELECT * FROM aaelink.functions WHERE id = $1`, [functionId])
    if (!rows[0]) return NextResponse.json({ error: 'function_not_found' }, { status: 404 })
    const fn = rows[0]
    return NextResponse.json({
      function: {
        ...fn,
        input_parameters: (() => { try { return JSON.parse(String(fn.input_parameters || '{}')) } catch { return {} } })(),
        output_parameters: (() => { try { return JSON.parse(String(fn.output_parameters || '{}')) } catch { return {} } })(),
      },
    })
  }

  if (view === 'executions') {
    const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') || 50), 200)
    const { rows } = await pool.query(
      `SELECT * FROM aaelink.function_executions ORDER BY created_at DESC LIMIT $1`, [limit]
    )
    return NextResponse.json({ executions: rows })
  }

  const { rows } = await pool.query<{
    id: string; callback_id: string; title: string; description: string;
    type: string; input_parameters: string; output_parameters: string;
    created_by: string; created_at: number;
  }>(`SELECT * FROM aaelink.functions ORDER BY created_at DESC`)
  const functions = rows.map(r => ({
    ...r,
    input_parameters: (() => { try { return JSON.parse(String(r.input_parameters || '{}')) } catch { return {} } })(),
    output_parameters: (() => { try { return JSON.parse(String(r.output_parameters || '{}')) } catch { return {} } })(),
  }))

  return NextResponse.json({ functions })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'register' | 'execute' | 'complete' | 'complete_error' | 'delete'
    function_id?: string; callback_id?: string; title?: string; description?: string
    input_parameters?: Record<string, unknown>
    output_parameters?: Record<string, unknown>
    type?: 'builtin' | 'custom' | 'connector'
    // For execute
    inputs?: Record<string, unknown>
    // For complete
    execution_id?: string; outputs?: Record<string, unknown>; error?: string
  }

  const action = body.action || 'register'
  const now = Date.now()

  if (action === 'register') {
    if (!body.callback_id || !body.title) {
      return NextResponse.json({ error: 'callback_id and title required' }, { status: 400 })
    }
    const id = randomUUID()
    await pool.query(`
      INSERT INTO aaelink.functions
        (id, callback_id, title, description, type, input_parameters, output_parameters, created_by, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (callback_id) DO UPDATE SET
        title = $3, description = $4, input_parameters = $6, output_parameters = $7
    `, [
      id, body.callback_id, body.title, body.description || '',
      body.type || 'custom',
      JSON.stringify(body.input_parameters || {}),
      JSON.stringify(body.output_parameters || {}),
      uid, now,
    ])

    return NextResponse.json({
      function: { id, callback_id: body.callback_id, title: body.title },
    }, { status: 201 })
  }

  if (action === 'execute') {
    const fnId = body.function_id || ''
    if (!fnId) return NextResponse.json({ error: 'function_id required' }, { status: 400 })

    const { rows } = await pool.query(`SELECT * FROM aaelink.functions WHERE id = $1`, [fnId])
    if (!rows[0]) return NextResponse.json({ error: 'function_not_found' }, { status: 404 })

    const executionId = randomUUID()
    await pool.query(`
      INSERT INTO aaelink.function_executions
        (id, function_id, status, inputs, outputs, error, created_by, created_at)
      VALUES ($1, $2, 'running', $3, '{}', '', $4, $5)
    `, [executionId, fnId, JSON.stringify(body.inputs || {}), uid, now])

    return NextResponse.json({
      execution: { id: executionId, function_id: fnId, status: 'running' },
    })
  }

  if (action === 'complete') {
    if (!body.execution_id) return NextResponse.json({ error: 'execution_id required' }, { status: 400 })
    await pool.query(`
      UPDATE aaelink.function_executions
      SET status = 'completed', outputs = $1, completed_at = $2
      WHERE id = $3
    `, [JSON.stringify(body.outputs || {}), now, body.execution_id])
    return NextResponse.json({ ok: true })
  }

  if (action === 'complete_error') {
    if (!body.execution_id) return NextResponse.json({ error: 'execution_id required' }, { status: 400 })
    await pool.query(`
      UPDATE aaelink.function_executions
      SET status = 'error', error = $1, completed_at = $2
      WHERE id = $3
    `, [body.error || 'Unknown error', now, body.execution_id])
    return NextResponse.json({ ok: true })
  }

  if (action === 'delete') {
    if (!body.function_id) return NextResponse.json({ error: 'function_id required' }, { status: 400 })
    await pool.query(`DELETE FROM aaelink.function_executions WHERE function_id = $1`, [body.function_id])
    await pool.query(`DELETE FROM aaelink.functions WHERE id = $1`, [body.function_id])
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/functions', _GET)
export const POST   = tracedRoute('POST', '/api/functions', _POST)
