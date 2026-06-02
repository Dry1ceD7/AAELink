import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { Pool } from 'pg'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

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

  await ensureWorkflowTables(pool)

  const workflowId = req.nextUrl.searchParams.get('workflow_id') || ''
  const view = req.nextUrl.searchParams.get('view') || 'list'
  const featured = req.nextUrl.searchParams.get('featured') === 'true'

  // Single workflow
  if (workflowId) {
    const { rows } = await pool.query<{
      id: string; name: string; description: string; icon: string;
      status: string; is_featured: boolean; created_by: string; created_at: number;
    }>(`SELECT * FROM aaelink.workflows WHERE id = $1`, [workflowId])
    if (!rows[0]) return NextResponse.json({ error: 'workflow_not_found' }, { status: 404 })

    const wf = rows[0]
    const { rows: steps } = await pool.query<{
      id: string; workflow_id: string; position: number; type: string;
      function_id: string; config: string; created_at: number;
    }>(
      `SELECT * FROM aaelink.workflow_steps WHERE workflow_id = $1 ORDER BY position ASC`, [workflowId]
    )
    const { rows: triggers } = await pool.query<{
      id: string; workflow_id: string; type: string; config: string; created_at: number;
    }>(
      `SELECT * FROM aaelink.workflow_triggers WHERE workflow_id = $1`, [workflowId]
    )
    const { rows: executions } = await pool.query(
      `SELECT * FROM aaelink.workflow_executions WHERE workflow_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [workflowId]
    )

    return NextResponse.json({
      workflow: {
        ...wf,
        steps: steps.map(s => ({ ...s, config: parseJSON(s.config) })),
        triggers: triggers.map(t => ({ ...t, config: parseJSON(t.config) })),
        recent_executions: executions,
      },
    })
  }

  // Executions view
  if (view === 'executions') {
    const { rows } = await pool.query(
      `SELECT e.*, w.name AS workflow_name
       FROM aaelink.workflow_executions e
       LEFT JOIN aaelink.workflows w ON w.id = e.workflow_id
       ORDER BY e.created_at DESC LIMIT 100`
    )
    return NextResponse.json({ executions: rows })
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
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  await ensureWorkflowTables(pool)

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
    const execId = randomUUID()
    await pool.query(`
      INSERT INTO aaelink.workflow_executions (id, workflow_id, status, triggered_by, created_at)
      VALUES ($1, $2, 'running', $3, $4)
    `, [execId, body.workflow_id, uid, now])
    return NextResponse.json({ execution: { id: execId, workflow_id: body.workflow_id, status: 'running' } })
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

function parseJSON(val: unknown): unknown {
  if (typeof val === 'string') { try { return JSON.parse(val) } catch { return val } }
  return val
}

async function ensureWorkflowTables(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.workflows (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      icon        TEXT NOT NULL DEFAULT '⚡',
      status      TEXT NOT NULL DEFAULT 'active',
      is_featured BOOLEAN NOT NULL DEFAULT false,
      created_by  TEXT NOT NULL DEFAULT '',
      created_at  BIGINT NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS aaelink.workflow_steps (
      id          TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      position    INTEGER NOT NULL DEFAULT 0,
      type        TEXT NOT NULL DEFAULT 'function',
      function_id TEXT NOT NULL DEFAULT '',
      config      JSONB NOT NULL DEFAULT '{}',
      created_at  BIGINT NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS aaelink.workflow_triggers (
      id          TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      type        TEXT NOT NULL DEFAULT 'webhook',
      config      JSONB NOT NULL DEFAULT '{}',
      created_at  BIGINT NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS aaelink.workflow_executions (
      id           TEXT PRIMARY KEY,
      workflow_id  TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      triggered_by TEXT NOT NULL DEFAULT '',
      error        TEXT NOT NULL DEFAULT '',
      created_at   BIGINT NOT NULL DEFAULT 0,
      completed_at BIGINT NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_wf_steps ON aaelink.workflow_steps(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_wf_triggers ON aaelink.workflow_triggers(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_wf_execs ON aaelink.workflow_executions(workflow_id, created_at DESC);
  `)
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/workflows', _GET)
export const POST   = tracedRoute('POST', '/api/workflows', _POST)
