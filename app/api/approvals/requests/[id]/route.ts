import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * GET /api/approvals/requests/[id] — Get detailed request info including the review trail.
 */
async function _GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const requestId = params.id

  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  await ensureSchema()
  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // Fetch the request
    const { rows: reqs } = await pool.query(
      `SELECT r.*, w.name AS workflow_name,
              TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS requester_name,
              u.username AS requester_username
       FROM aaelink.approval_requests r
       LEFT JOIN aaelink.workflows w ON r.workflow_id = w.id
       LEFT JOIN aaelink.users u ON r.requester_id = u.id
       WHERE r.id = $1`,
      [requestId]
    )
    if (reqs.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Fetch all reviews (audit trail)
    const { rows: reviews } = await pool.query(
      `SELECT rv.*, 
              TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS reviewer_name,
              u.username AS reviewer_username
       FROM aaelink.approval_reviews rv
       LEFT JOIN aaelink.users u ON rv.reviewer_id = u.id
       WHERE rv.request_id = $1
       ORDER BY rv.step_order ASC, rv.created_at ASC`,
      [requestId]
    )

    // Fetch all workflow steps for context
    const req = reqs[0]
    let steps: { step_order: number; approver_user_id: string | null; approver_role: string }[] = []
    if (req.workflow_id) {
      const { rows: stepRows } = await pool.query(
        `SELECT s.step_order, s.approver_user_id, s.approver_role,
                TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS approver_name,
                u.username AS approver_username
         FROM aaelink.workflow_steps s
         LEFT JOIN aaelink.users u ON s.approver_user_id = u.id
         WHERE s.workflow_id = $1
         ORDER BY s.step_order ASC`,
        [req.workflow_id]
      )
      steps = stepRows
    }

    return NextResponse.json({
      request: req,
      reviews,
      steps
    })
  } catch (err: unknown) {
    console.error('Error fetching approval request detail:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/**
 * DELETE /api/approvals/requests/[id] — Cancel a pending request (requester only).
 */
async function _DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const requestId = params.id

  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  await ensureSchema()
  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: reqs } = await client.query(
      `SELECT id, requester_id, status, title, workspace_id FROM aaelink.approval_requests WHERE id = $1 FOR UPDATE`,
      [requestId]
    )
    const req = reqs[0]
    if (!req) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (req.requester_id !== userId) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Only the requester can cancel this request' }, { status: 403 })
    }

    if (req.status !== 'pending') {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Request is no longer pending' }, { status: 400 })
    }

    const now = Date.now()
    await client.query(
      `UPDATE aaelink.approval_requests SET status = 'canceled', updated_at = $1 WHERE id = $2`,
      [now, requestId]
    )

    // Audit log
    const { rows: uRows } = await client.query(`SELECT platform_role FROM aaelink.users WHERE id = $1`, [userId])
    const role = uRows[0]?.platform_role || ''

    await client.query(
      `INSERT INTO aaelink.audit_log (id, workspace_id, actor_id, actor_role, action, resource_kind, resource_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, 'approval.cancel', 'approval_request', $5, '{}', $6)`,
      [randomUUID(), req.workspace_id, userId, role, requestId, now]
    )

    await client.query('COMMIT')
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    await client.query('ROLLBACK')
    console.error('Error canceling approval request:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  } finally {
    client.release()
  }
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/approvals/requests/:id', _GET)
export const DELETE = tracedRoute('DELETE', '/api/approvals/requests/:id', _DELETE)
