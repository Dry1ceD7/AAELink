import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspaceId = req.nextUrl.searchParams.get('workspace_id')
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 })

  const { rows } = await pool.query(
    `SELECT w.*, 
            COALESCE(
              json_agg(
                json_build_object(
                  'id', s.id,
                  'step_order', s.step_order,
                  'approver_user_id', s.approver_user_id,
                  'approver_role', s.approver_role
                ) ORDER BY s.step_order ASC
              ) FILTER (WHERE s.id IS NOT NULL),
              '[]'
            ) as steps
     FROM aaelink.workflows w
     LEFT JOIN aaelink.workflow_steps s ON s.workflow_id = w.id
     WHERE w.workspace_id = $1 AND w.is_active = true
     GROUP BY w.id
     ORDER BY w.created_at DESC`,
    [workspaceId]
  )

  return NextResponse.json({ workflows: rows })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query(`SELECT platform_role FROM aaelink.users WHERE id = $1`, [userId])
  const role = uRows[0]?.platform_role || ''

  // Only admins should create workflows (you can refine this logic based on your RBAC)
  if (!['super_admin', 'it_admin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const { workspace_id, name, description, steps } = body as {
    workspace_id?: string
    name?: string
    description?: string
    steps?: { approver_user_id?: string; approver_role?: string }[]
  }

  if (!workspace_id || !name || !steps || steps.length === 0) {
    return NextResponse.json({ error: 'workspace_id, name, and at least one step are required' }, { status: 400 })
  }

  const workflowId = randomUUID()
  const now = Date.now()

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    
    await client.query(
      `INSERT INTO aaelink.workflows (id, workspace_id, name, description, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [workflowId, workspace_id, name, description || '', userId, now, now]
    )

    let order = 1
    for (const step of steps) {
      const stepId = randomUUID()
      await client.query(
        `INSERT INTO aaelink.workflow_steps (id, workflow_id, step_order, approver_user_id, approver_role, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [stepId, workflowId, order++, step.approver_user_id || null, step.approver_role || '', now]
      )
    }

    await client.query('COMMIT')
    return NextResponse.json({ success: true, id: workflowId })
  } catch (err: unknown) {
    await client.query('ROLLBACK')
    console.error('Error creating workflow:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  } finally {
    client.release()
  }
}

/** PATCH /api/approvals/workflows — Deactivate or rename a workflow. Body: { workflow_id, is_active?, name? } */
async function _PATCH(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query(`SELECT platform_role FROM aaelink.users WHERE id = $1`, [userId])
  const role = uRows[0]?.platform_role || ''
  if (!['super_admin', 'it_admin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const { workflow_id, is_active, name } = body as {
    workflow_id?: string
    is_active?: boolean
    name?: string
  }

  if (!workflow_id) {
    return NextResponse.json({ error: 'workflow_id is required' }, { status: 400 })
  }

  const sets: string[] = []
  const vals: unknown[] = []
  let idx = 1

  if (typeof is_active === 'boolean') {
    sets.push(`is_active = $${idx++}`)
    vals.push(is_active)
  }
  if (typeof name === 'string' && name.trim()) {
    sets.push(`name = $${idx++}`)
    vals.push(name.trim())
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  sets.push(`updated_at = $${idx++}`)
  vals.push(Date.now())
  vals.push(workflow_id)

  await pool.query(
    `UPDATE aaelink.workflows SET ${sets.join(', ')} WHERE id = $${idx}`,
    vals
  )

  return NextResponse.json({ success: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/approvals/workflows', _GET)
export const POST   = tracedRoute('POST', '/api/approvals/workflows', _POST)
export const PATCH  = tracedRoute('PATCH', '/api/approvals/workflows', _PATCH)
