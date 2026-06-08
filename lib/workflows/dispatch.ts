/**
 * Workflow execution dispatch (Integrations parity §30).
 *
 * Creates a workflow_execution row and enqueues a 'workflow_run' worker job that
 * drives lib/workflows/engine.ts. Extracted from app/api/workflows/route.ts so
 * the route stays thin and the RBAC + enqueue + audit sequence is unit-testable.
 *
 * RBAC: only the workflow's creator or a platform admin (super_admin / it_admin)
 * may trigger a run.
 */
import { randomUUID } from 'crypto'
import type { Pool } from 'pg'

export type DispatchResult =
  | { ok: true; executionId: string }
  | { ok: false; error: 'workflow_not_found' | 'forbidden'; status: 404 | 403 }

export async function dispatchWorkflowExecution(
  pool: Pool,
  workflowId: string,
  uid: string,
  input: Record<string, unknown>
): Promise<DispatchResult> {
  const now = Date.now()

  const { rows: wfRows } = await pool.query<{ created_by: string }>(
    `SELECT created_by FROM aaelink.workflows WHERE id = $1`, [workflowId]
  )
  if (!wfRows[0]) return { ok: false, error: 'workflow_not_found', status: 404 }

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  const role = uRows[0]?.platform_role || ''
  const isAdmin = role === 'super_admin' || role === 'it_admin'
  if (wfRows[0].created_by !== uid && !isAdmin) {
    return { ok: false, error: 'forbidden', status: 403 }
  }

  const execId = randomUUID()
  await pool.query(`
    INSERT INTO aaelink.workflow_executions (id, workflow_id, status, triggered_by, context, step_cursor, created_at)
    VALUES ($1, $2, 'running', $3, $4, 0, $5)
  `, [execId, workflowId, uid, JSON.stringify({ input: input || {} }), now])

  // Enqueue the worker job that drives the engine (replaces the old behaviour of
  // leaving status 'running' for an external caller to finish).
  await pool.query(`
    INSERT INTO aaelink.jobs
      (id, type, status, priority, payload, run_after, max_retries, attempts, created_by, created_at)
    VALUES ($1, 'workflow_run', 'pending', 5, $2, $3, 3, 0, $4, $3)
  `, [randomUUID(), JSON.stringify({ execution_id: execId, workflow_id: workflowId }), now, uid])

  // Best-effort audit (write affecting workflow/automation scope). The audit_log
  // table has no column defaults, so id (randomUUID) and created_at (epoch ms) are
  // both supplied explicitly.
  try {
    await pool.query(`
      INSERT INTO aaelink.audit_log (id, actor_id, action, resource_kind, resource_id, metadata, created_at)
      VALUES ($1, $2, 'workflow.execute', 'workflow', $3, $4, $5)
    `, [randomUUID(), uid, workflowId, JSON.stringify({ execution_id: execId }), now])
  } catch { /* audit failures must never break the request path */ }

  return { ok: true, executionId: execId }
}
