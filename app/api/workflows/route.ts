import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { verifyCsrf } from '@/lib/auth/csrf'
import { dispatchWorkflowExecution } from '@/lib/workflows/dispatch'
import { loadWorkflowDetail, listRecentExecutions } from '@/lib/workflows/queries'

/**
 * Workflows API — Slack workflows.* parity.
 *
 * Full workflow builder: define multi-step workflows with triggers,
 * steps (functions, messages, forms), conditions, and variables.
 *
 * GET  /api/workflows — list/get workflows
 * POST /api/workflows — create/update/delete/execute/feature workflows
 *
 * Covers:
 *   - workflows.stepCompleted / stepFailed
 *   - workflows.featured.add/remove
 *   - Trigger management (webhook, schedule, event, shortcut, channel)
 *   - Step management with function/message/form types
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const workflowId = req.nextUrl.searchParams.get('workflow_id') || ''
  const view = req.nextUrl.searchParams.get('view') || 'list'
  const featured = req.nextUrl.searchParams.get('featured') === 'true'

  // Single workflow
  if (workflowId) {
    const workflow = await loadWorkflowDetail(pool, workflowId)
    if (!workflow) return NextResponse.json({ error: 'workflow_not_found' }, { status: 404 })
    return NextResponse.json({ workflow })
  }

  // Executions view
  if (view === 'executions') {
    return NextResponse.json({ executions: await listRecentExecutions(pool) })
  }

  // List workflows
  let query = `SELECT * FROM aaelink.workflows WHERE 1=1`
  const params: unknown[] = []
  if (featured) {
    query += ` AND is_featured = true`
  }
  query += ` ORDER BY created_at DESC`

  const { rows } = await pool.query(query, params)
  return NextResponse.json({ workflows: rows })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const csrfErr = await verifyCsrf(req)
  if (csrfErr) return csrfErr
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    action?: string; workflow_id?: string; name?: string; description?: string; icon?: string
    steps?: Array<{ type: string; function_id?: string; config?: Record<string, unknown> }>
    triggers?: Array<{ type: string; config?: Record<string, unknown> }>
    // Step operations
    step_id?: string; execution_id?: string; outputs?: Record<string, unknown>; error?: string
  }

  const action = body.action || 'create'
  const now = Date.now()

  if (action === 'create') {
    if (!body.name) return NextResponse.json({ error: 'name required' }, { status: 400 })
    const id = randomUUID()

    await pool.query(`
      INSERT INTO aaelink.workflows (id, name, description, icon, status, created_by, created_at)
      VALUES ($1, $2, $3, $4, 'active', $5, $6)
    `, [id, body.name, body.description || '', body.icon || '⚡', uid, now])

    // Add steps
    if (body.steps?.length) {
      for (let i = 0; i < body.steps.length; i++) {
        const step = body.steps[i]
        await pool.query(`
          INSERT INTO aaelink.workflow_steps (id, workflow_id, position, type, function_id, config, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [randomUUID(), id, i + 1, step.type || 'function', step.function_id || '', JSON.stringify(step.config || {}), now])
      }
    }

    // Add triggers
    if (body.triggers?.length) {
      for (const trigger of body.triggers) {
        await pool.query(`
          INSERT INTO aaelink.workflow_triggers (id, workflow_id, type, config, created_at)
          VALUES ($1, $2, $3, $4, $5)
        `, [randomUUID(), id, trigger.type || 'webhook', JSON.stringify(trigger.config || {}), now])
      }
    }

    return NextResponse.json({ workflow: { id, name: body.name } }, { status: 201 })
  }

  if (action === 'update') {
    if (!body.workflow_id) return NextResponse.json({ error: 'workflow_id required' }, { status: 400 })
    const updates: string[] = []
    const params: unknown[] = []
    if (body.name) { params.push(body.name); updates.push(`name = $${params.length}`) }
    if (body.description !== undefined) { params.push(body.description); updates.push(`description = $${params.length}`) }
    if (body.icon) { params.push(body.icon); updates.push(`icon = $${params.length}`) }
    if (updates.length > 0) {
      params.push(body.workflow_id)
      await pool.query(`UPDATE aaelink.workflows SET ${updates.join(', ')} WHERE id = $${params.length}`, params)
    }
    return NextResponse.json({ ok: true })
  }

  if (action === 'delete') {
    if (!body.workflow_id) return NextResponse.json({ error: 'workflow_id required' }, { status: 400 })
    await pool.query(`DELETE FROM aaelink.workflow_executions WHERE workflow_id = $1`, [body.workflow_id])
    await pool.query(`DELETE FROM aaelink.workflow_triggers WHERE workflow_id = $1`, [body.workflow_id])
    await pool.query(`DELETE FROM aaelink.workflow_steps WHERE workflow_id = $1`, [body.workflow_id])
    await pool.query(`DELETE FROM aaelink.workflows WHERE id = $1`, [body.workflow_id])
    return NextResponse.json({ ok: true })
  }

  if (action === 'execute') {
    if (!body.workflow_id) return NextResponse.json({ error: 'workflow_id required' }, { status: 400 })
    // RBAC + execution-row + worker-job enqueue + audit (extracted to lib/).
    const res = await dispatchWorkflowExecution(pool, body.workflow_id, uid, body.outputs || {})
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
    return NextResponse.json({ execution: { id: res.executionId, workflow_id: body.workflow_id, status: 'running' } })
  }

  if (action === 'step_completed') {
    if (!body.execution_id) return NextResponse.json({ error: 'execution_id required' }, { status: 400 })
    await pool.query(`
      UPDATE aaelink.workflow_executions SET status = 'completed', completed_at = $1 WHERE id = $2
    `, [now, body.execution_id])
    return NextResponse.json({ ok: true })
  }

  if (action === 'step_failed') {
    if (!body.execution_id) return NextResponse.json({ error: 'execution_id required' }, { status: 400 })
    await pool.query(`
      UPDATE aaelink.workflow_executions SET status = 'failed', error = $1, completed_at = $2 WHERE id = $3
    `, [body.error || 'Step failed', now, body.execution_id])
    return NextResponse.json({ ok: true })
  }

  if (action === 'feature') {
    if (!body.workflow_id) return NextResponse.json({ error: 'workflow_id required' }, { status: 400 })
    await pool.query(`UPDATE aaelink.workflows SET is_featured = true WHERE id = $1`, [body.workflow_id])
    return NextResponse.json({ ok: true })
  }

  if (action === 'unfeature') {
    if (!body.workflow_id) return NextResponse.json({ error: 'workflow_id required' }, { status: 400 })
    await pool.query(`UPDATE aaelink.workflows SET is_featured = false WHERE id = $1`, [body.workflow_id])
    return NextResponse.json({ ok: true })
  }

  if (action === 'activate') {
    if (!body.workflow_id) return NextResponse.json({ error: 'workflow_id required' }, { status: 400 })
    await pool.query(`UPDATE aaelink.workflows SET status = 'active' WHERE id = $1`, [body.workflow_id])
    return NextResponse.json({ ok: true })
  }

  if (action === 'deactivate') {
    if (!body.workflow_id) return NextResponse.json({ error: 'workflow_id required' }, { status: 400 })
    await pool.query(`UPDATE aaelink.workflows SET status = 'inactive' WHERE id = $1`, [body.workflow_id])
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/workflows', _GET)
export const POST   = tracedRoute('POST', '/api/workflows', _POST)
