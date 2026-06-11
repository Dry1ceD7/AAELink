/**
 * Workflow read helpers (Integrations parity §30).
 *
 * Extracted from app/api/workflows/route.ts so the route stays under the size
 * budget. Pure reads — no auth (the route gates the session before calling).
 */
import type { Pool } from 'pg'

function parseJSON(val: unknown): unknown {
  if (typeof val === 'string') { try { return JSON.parse(val) } catch { return val } }
  return val
}

/** Load a single workflow with its steps, triggers, and recent executions. */
export async function loadWorkflowDetail(pool: Pool, workflowId: string): Promise<unknown | null> {
  const { rows } = await pool.query<{
    id: string; name: string; description: string; icon: string;
    status: string; is_featured: boolean; created_by: string; created_at: number;
  }>(`SELECT * FROM aaelink.workflows WHERE id = $1`, [workflowId])
  if (!rows[0]) return null
  const wf = rows[0]

  const { rows: steps } = await pool.query<{
    id: string; workflow_id: string; position: number; type: string;
    function_id: string; config: string; created_at: number;
  }>(`SELECT * FROM aaelink.workflow_steps WHERE workflow_id = $1 ORDER BY position ASC`, [workflowId])

  const { rows: triggers } = await pool.query<{
    id: string; workflow_id: string; type: string; config: string; created_at: number;
  }>(`SELECT * FROM aaelink.workflow_triggers WHERE workflow_id = $1`, [workflowId])

  const { rows: executions } = await pool.query(
    `SELECT * FROM aaelink.workflow_executions WHERE workflow_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [workflowId]
  )

  return {
    ...wf,
    steps: steps.map(s => ({ ...s, config: parseJSON(s.config) })),
    triggers: triggers.map(t => ({ ...t, config: parseJSON(t.config) })),
    recent_executions: executions,
  }
}

/** Recent executions across all workflows (executions view). */
export async function listRecentExecutions(pool: Pool): Promise<unknown[]> {
  const { rows } = await pool.query(
    `SELECT e.*, w.name AS workflow_name
       FROM aaelink.workflow_executions e
       LEFT JOIN aaelink.workflows w ON w.id = e.workflow_id
       ORDER BY e.created_at DESC LIMIT 100`
  )
  return rows
}
