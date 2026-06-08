/**
 * Workflow execution engine (Integrations parity §30 — Slack Workflow Builder).
 *
 * Drives a workflow_execution row: loads its ordered steps and runs them
 * sequentially from the persisted step_cursor, threading an execution context
 * (each step's output is available to later steps). Records one
 * workflow_step_executions row per step (status completed | failed | skipped),
 * then finalizes the execution status (completed | failed).
 *
 * A 'delay' step suspends the run: the engine persists the cursor + context and
 * returns { suspended, resumeAfterMs } so the WORKER can enqueue a continuation
 * job. A 'conditional' step with halt_on_false stops the run gracefully.
 *
 * A max-steps guard bounds runaway/pathological workflows so a misconfigured or
 * cyclic step list can never run unbounded.
 */
import { randomUUID } from 'crypto'
import type { Pool } from 'pg'
import { log } from '@/lib/infra/log'
import {
  runPostMessage, runCallWebhook, runDelay, evalConditional,
  type StepContext,
} from '@/lib/workflows/steps'

export const MAX_WORKFLOW_STEPS = 50

interface StepRow {
  id: string; workflow_id: string; position: number
  type: string; function_id: string | null; config: unknown
}

interface ExecRow {
  id: string; workflow_id: string; status: string
  triggered_by: string; context: unknown; step_cursor: number
}

export interface EngineResult {
  status: 'completed' | 'failed' | 'suspended'
  stepsRun: number
  resumeAfterMs?: number
  error?: string
}

function parseObj(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object') return v as Record<string, unknown>
  if (typeof v === 'string') { try { return JSON.parse(v) } catch { return {} } }
  return {}
}

async function recordStep(
  pool: Pool, exec: ExecRow, step: StepRow,
  status: 'completed' | 'failed' | 'skipped',
  output: Record<string, unknown>, error: string
): Promise<void> {
  await pool.query(
    `INSERT INTO aaelink.workflow_step_executions
       (id, execution_id, workflow_id, step_id, position, type, status, output, error, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [randomUUID(), exec.id, exec.workflow_id, step.id, step.position,
      step.type, status, JSON.stringify(output), error, Date.now()]
  )
}

/**
 * Execute (or resume) a workflow_execution. Returns the terminal/suspended state.
 * Idempotent on already-finished executions (returns their status, runs nothing).
 */
export async function runWorkflowExecution(pool: Pool, executionId: string): Promise<EngineResult> {
  const { rows } = await pool.query<ExecRow>(
    `SELECT id, workflow_id, status, triggered_by, context, step_cursor
       FROM aaelink.workflow_executions WHERE id = $1`,
    [executionId]
  )
  const exec = rows[0]
  if (!exec) return { status: 'failed', stepsRun: 0, error: 'execution_not_found' }
  if (exec.status === 'completed' || exec.status === 'failed') {
    return { status: exec.status, stepsRun: 0 }
  }

  const { rows: allSteps } = await pool.query<StepRow>(
    `SELECT id, workflow_id, position, type, function_id, config
       FROM aaelink.workflow_steps WHERE workflow_id = $1 ORDER BY position ASC`,
    [exec.workflow_id]
  )

  const vars = parseObj(exec.context)
  if (!vars.steps) vars.steps = {}
  const stepVars = vars.steps as Record<string, unknown>
  const ctx: StepContext = {
    execution_id: exec.id, workflow_id: exec.workflow_id,
    triggered_by: exec.triggered_by, vars,
  }

  let cursor = Number(exec.step_cursor || 0)
  let stepsRun = 0

  while (cursor < allSteps.length) {
    // Max-steps guard: bound total work for THIS engine pass (delay continuations
    // advance the cursor so the guard is per-resume, never cumulative-unbounded).
    if (stepsRun >= MAX_WORKFLOW_STEPS) {
      return finalize(pool, exec, 'failed', vars, cursor,
        `max_steps_exceeded:${MAX_WORKFLOW_STEPS}`, stepsRun)
    }

    const step = allSteps[cursor]
    const cfg = parseObj(step.config)
    try {
      if (step.type === 'delay') {
        const res = runDelay(cfg)
        if (res.kind === 'delay') {
          await recordStep(pool, exec, step, 'completed', { delayed_ms: res.resumeAfterMs }, '')
          // Persist cursor PAST the delay so the resume runs the next step.
          await persist(pool, exec.id, vars, cursor + 1, 'running')
          return { status: 'suspended', stepsRun, resumeAfterMs: res.resumeAfterMs }
        }
      } else if (step.type === 'conditional') {
        const { passed, halt } = evalConditional(cfg, vars)
        stepVars[String(step.position)] = { passed }
        await recordStep(pool, exec, step, passed ? 'completed' : 'skipped', { passed }, '')
        if (halt) {
          return finalize(pool, exec, 'completed', vars, cursor + 1, '', stepsRun + 1)
        }
      } else {
        const res = step.type === 'post_message'
          ? await runPostMessage(pool, cfg, ctx)
          : step.type === 'call_webhook'
            ? await runCallWebhook(cfg, ctx)
            : { kind: 'output' as const, output: { skipped_type: step.type } }
        const output = res.kind === 'output' ? res.output : {}
        stepVars[String(step.position)] = output
        await recordStep(pool, exec, step, 'completed', output, '')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'step_failed'
      await recordStep(pool, exec, step, 'failed', {}, msg)
      log.warn('workflow.step_failed', { execution_id: exec.id, position: step.position, error: msg })
      return finalize(pool, exec, 'failed', vars, cursor, msg, stepsRun + 1)
    }

    cursor++
    stepsRun++
  }

  return finalize(pool, exec, 'completed', vars, cursor, '', stepsRun)
}

async function persist(
  pool: Pool, execId: string, vars: Record<string, unknown>,
  cursor: number, status: string
): Promise<void> {
  await pool.query(
    `UPDATE aaelink.workflow_executions SET context = $1, step_cursor = $2, status = $3 WHERE id = $4`,
    [JSON.stringify(vars), cursor, status, execId]
  )
}

async function finalize(
  pool: Pool, exec: ExecRow, status: 'completed' | 'failed',
  vars: Record<string, unknown>, cursor: number, error: string, stepsRun: number
): Promise<EngineResult> {
  await pool.query(
    `UPDATE aaelink.workflow_executions
       SET status = $1, error = $2, context = $3, step_cursor = $4, completed_at = $5
     WHERE id = $6`,
    [status, error, JSON.stringify(vars), cursor, Date.now(), exec.id]
  )
  return { status, stepsRun, error: error || undefined }
}
