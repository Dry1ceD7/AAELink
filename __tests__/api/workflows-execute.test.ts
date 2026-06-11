/**
 * Integration test: workflow execute action (Integrations parity §30).
 *
 * The execute action used to only INSERT a workflow_executions row with status
 * 'running' and leave it for an external caller. It now:
 *   - enforces RBAC (only the workflow creator or a platform admin may run it),
 *   - enforces CSRF (session mutation),
 *   - creates the execution row AND enqueues a 'workflow_run' worker job that
 *     drives lib/workflows/engine.ts,
 *   - writes a 'workflow.execute' audit_log row.
 *
 * Each assertion fails if the corresponding enforcement is removed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, asRequest,
  expectSuccess, expectError, cleanupTestData,
  TestContext, TestUser,
} from '../helpers'
import { POST } from '@/app/api/workflows/route'

let ctx: TestContext
let owner: TestUser
let other: TestUser
let admin: TestUser
let wsId: string
const userIds: string[] = []
const wfIds: string[] = []

async function makeWorkflow(creatorId: string): Promise<string> {
  const id = randomUUID()
  // workflows.workspace_id is NOT NULL with an FK to workspaces, so a real
  // workspace must be supplied.
  await ctx.pool.query(
    `INSERT INTO aaelink.workflows (id, name, status, workspace_id, created_by, created_at)
     VALUES ($1, $2, 'active', $3, $4, $5)`,
    [id, `wf-${id.slice(0, 8)}`, wsId, creatorId, Date.now()]
  )
  wfIds.push(id)
  return id
}

beforeAll(async () => {
  ctx = await createTestContext()
  owner = await createTestUser(ctx.pool, { role: 'employee' })
  other = await createTestUser(ctx.pool, { role: 'employee' })
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  userIds.push(owner.id, other.id, admin.id)
  const { rows: [m] } = await ctx.pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.workspace_members WHERE user_id = $1 LIMIT 1`, [owner.id]
  )
  wsId = m.workspace_id
})

afterAll(async () => {
  for (const id of wfIds) {
    await ctx.pool.query(`DELETE FROM aaelink.workflow_executions WHERE workflow_id = $1`, [id])
    await ctx.pool.query(`DELETE FROM aaelink.workflows WHERE id = $1`, [id])
  }
  await ctx.pool.query(`DELETE FROM aaelink.jobs WHERE type = 'workflow_run' AND created_by = ANY($1)`, [userIds])
  await cleanupTestData(ctx.pool, userIds)
  await ctx.cleanup()
})

describe('POST /api/workflows execute — enqueue', () => {
  it('creates an execution row and enqueues a workflow_run job (creator)', async () => {
    const wf = await makeWorkflow(owner.id)
    const req = asRequest('POST', '/api/workflows', {
      cookie: owner.sessionCookie,
      body: { action: 'execute', workflow_id: wf },
    })
    const res = await POST(req)
    const out = await expectSuccess<{ execution: { id: string; status: string } }>(res)
    expect(out.execution.status).toBe('running')

    // Execution row exists.
    const { rows: execs } = await ctx.pool.query(
      `SELECT id FROM aaelink.workflow_executions WHERE id = $1`, [out.execution.id]
    )
    expect(execs.length).toBe(1)

    // A workflow_run job was enqueued carrying this execution id.
    const { rows: jobs } = await ctx.pool.query<{ payload: string }>(
      `SELECT payload FROM aaelink.jobs WHERE type = 'workflow_run' AND created_by = $1`, [owner.id]
    )
    const matched = jobs.some(j => {
      try { return (JSON.parse(j.payload) as { execution_id?: string }).execution_id === out.execution.id }
      catch { return false }
    })
    expect(matched).toBe(true)

    // Audit row written.
    const { rows: audit } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.audit_log WHERE action = 'workflow.execute' AND resource_id = $1 AND actor_id = $2`,
      [wf, owner.id]
    )
    expect(audit.length).toBeGreaterThan(0)
  })

  it('allows a platform admin who is not the creator', async () => {
    const wf = await makeWorkflow(owner.id)
    const req = asRequest('POST', '/api/workflows', {
      cookie: admin.sessionCookie,
      body: { action: 'execute', workflow_id: wf },
    })
    const res = await POST(req)
    await expectSuccess(res)
  })
})

describe('POST /api/workflows execute — RBAC + auth', () => {
  it('rejects a non-creator non-admin with 403', async () => {
    const wf = await makeWorkflow(owner.id)
    const req = asRequest('POST', '/api/workflows', {
      cookie: other.sessionCookie,
      body: { action: 'execute', workflow_id: wf },
    })
    const res = await POST(req)
    await expectError(res, 403, 'forbidden')
  })

  it('returns 404 for an unknown workflow', async () => {
    const req = asRequest('POST', '/api/workflows', {
      cookie: owner.sessionCookie,
      body: { action: 'execute', workflow_id: randomUUID() },
    })
    const res = await POST(req)
    await expectError(res, 404, 'workflow_not_found')
  })

  it('rejects an unauthenticated request', async () => {
    const wf = await makeWorkflow(owner.id)
    const req = asRequest('POST', '/api/workflows', {
      body: { action: 'execute', workflow_id: wf },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('rejects a mutation missing the CSRF token', async () => {
    const wf = await makeWorkflow(owner.id)
    const req = asRequest('POST', '/api/workflows', {
      cookie: owner.sessionCookie,
      body: { action: 'execute', workflow_id: wf },
      noAutoCsrf: true,
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })
})
