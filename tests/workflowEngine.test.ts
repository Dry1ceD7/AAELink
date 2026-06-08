/**
 * AAELink — Workflow execution engine (live DB).
 *
 * Integrations parity §30 (Slack Workflow Builder). Before this engine,
 * workflow_executions only ever held status 'running' — no engine ran the steps.
 * lib/workflows/engine.ts now runs ordered steps sequentially, records one
 * workflow_step_executions row per step (step_completed / step_failed), threads
 * an execution context (prior-step outputs available to later steps), and
 * finalizes the execution status.
 *
 * Scenarios (each fails if the corresponding behaviour is removed):
 *   1. A 2-step workflow (post_message -> conditional) runs to 'completed' and
 *      the post_message step actually creates a message row.
 *   2. A failing step (post_message missing channel) records a 'failed' step row
 *      AND marks the execution 'failed'.
 *   3. The max-steps guard halts a pathological workflow (> MAX_WORKFLOW_STEPS)
 *      with a max_steps_exceeded error instead of running unbounded.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, createTestChannel,
  TestContext, TestUser, TestChannel,
} from '../__tests__/helpers'
import { runWorkflowExecution, MAX_WORKFLOW_STEPS } from '@/lib/workflows/engine'

let ctx: TestContext
let user: TestUser
let ch: TestChannel
let wsId: string
const userIds: string[] = []
const wfIds: string[] = []

async function makeWorkflow(): Promise<string> {
  const id = randomUUID()
  // workflows.workspace_id is NOT NULL with an FK to workspaces (approval-domain
  // shape), so a real workspace must be supplied.
  await ctx.pool.query(
    `INSERT INTO aaelink.workflows (id, name, status, workspace_id, created_by, created_at)
     VALUES ($1, $2, 'active', $3, $4, $5)`,
    [id, `wf-${id.slice(0, 8)}`, wsId, user.id, Date.now()]
  )
  wfIds.push(id)
  return id
}

async function addStep(
  workflowId: string, position: number, type: string, config: Record<string, unknown>
): Promise<void> {
  await ctx.pool.query(
    `INSERT INTO aaelink.workflow_steps (id, workflow_id, position, type, function_id, config, created_at)
     VALUES ($1, $2, $3, $4, '', $5, $6)`,
    [randomUUID(), workflowId, position, type, JSON.stringify(config), Date.now()]
  )
}

async function makeExecution(workflowId: string): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.workflow_executions (id, workflow_id, status, triggered_by, context, step_cursor, created_at)
     VALUES ($1, $2, 'running', $3, '{}', 0, $4)`,
    [id, workflowId, user.id, Date.now()]
  )
  return id
}

async function stepRows(executionId: string) {
  const { rows } = await ctx.pool.query<{ status: string; type: string; error: string }>(
    `SELECT status, type, error FROM aaelink.workflow_step_executions
       WHERE execution_id = $1 ORDER BY position ASC`,
    [executionId]
  )
  return rows
}

async function execStatus(executionId: string) {
  const { rows } = await ctx.pool.query<{ status: string; error: string }>(
    `SELECT status, error FROM aaelink.workflow_executions WHERE id = $1`, [executionId]
  )
  return rows[0]
}

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(user.id)
  ch = await createTestChannel(ctx.pool, user.id, { name: `wfe-${randomUUID().slice(0, 8)}` })
  const { rows: [m] } = await ctx.pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.workspace_members WHERE user_id = $1 LIMIT 1`, [user.id]
  )
  wsId = m.workspace_id
})

afterAll(async () => {
  for (const id of wfIds) {
    await ctx.pool.query(`DELETE FROM aaelink.workflow_step_executions WHERE workflow_id = $1`, [id])
    await ctx.pool.query(`DELETE FROM aaelink.workflow_executions WHERE workflow_id = $1`, [id])
    await ctx.pool.query(`DELETE FROM aaelink.workflow_steps WHERE workflow_id = $1`, [id])
    await ctx.pool.query(`DELETE FROM aaelink.workflows WHERE id = $1`, [id])
  }
  const { cleanupTestData } = await import('../__tests__/helpers')
  await cleanupTestData(ctx.pool, userIds)
  await ctx.cleanup()
})

describe('workflow engine — post_message -> conditional', () => {
  it('runs to completed and creates the message', async () => {
    const wf = await makeWorkflow()
    await addStep(wf, 1, 'post_message', { channel_id: ch.id, text: 'hello from workflow' })
    // conditional reads the prior step's output threaded into context.
    await addStep(wf, 2, 'conditional', { left: '{{steps.1.channel_id}}', op: 'eq', right: ch.id })
    const exec = await makeExecution(wf)

    const result = await runWorkflowExecution(ctx.pool, exec)
    expect(result.status).toBe('completed')
    expect(result.stepsRun).toBe(2)

    // Execution finalized.
    expect((await execStatus(exec)).status).toBe('completed')

    // Both steps recorded completed.
    const rows = await stepRows(exec)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ type: 'post_message', status: 'completed' })
    expect(rows[1]).toMatchObject({ type: 'conditional', status: 'completed' })

    // A real message was created in the target channel.
    const { rows: msgs } = await ctx.pool.query(
      `SELECT body FROM aaelink.messages WHERE channel_id = $1 AND body = $2`,
      [ch.id, 'hello from workflow']
    )
    expect(msgs.length).toBe(1)
  })
})

describe('workflow engine — failing step', () => {
  it('marks step_failed and the execution failed', async () => {
    const wf = await makeWorkflow()
    // post_message with no channel_id -> the step throws post_message_missing_channel.
    await addStep(wf, 1, 'post_message', { text: 'no channel' })
    const exec = await makeExecution(wf)

    const result = await runWorkflowExecution(ctx.pool, exec)
    expect(result.status).toBe('failed')

    const rows = await stepRows(exec)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('failed')
    expect(rows[0].error).toContain('post_message_missing_channel')

    const exStatus = await execStatus(exec)
    expect(exStatus.status).toBe('failed')
    expect(exStatus.error).toContain('post_message_missing_channel')
  })
})

describe('workflow engine — max-steps guard', () => {
  it('halts a pathological workflow exceeding MAX_WORKFLOW_STEPS', async () => {
    const wf = await makeWorkflow()
    // Add MAX + 5 harmless conditional steps (always pass) so the run would
    // otherwise complete all of them; the guard must stop it first.
    const total = MAX_WORKFLOW_STEPS + 5
    for (let i = 1; i <= total; i++) {
      await addStep(wf, i, 'conditional', { left: '1', op: 'eq', right: '1' })
    }
    const exec = await makeExecution(wf)

    const result = await runWorkflowExecution(ctx.pool, exec)
    expect(result.status).toBe('failed')
    expect(result.stepsRun).toBe(MAX_WORKFLOW_STEPS)

    const exStatus = await execStatus(exec)
    expect(exStatus.status).toBe('failed')
    expect(exStatus.error).toContain('max_steps_exceeded')

    // It recorded exactly MAX steps, not all of them.
    const rows = await stepRows(exec)
    expect(rows.length).toBe(MAX_WORKFLOW_STEPS)
  })
})
