import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

async function _POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const requestId = params.id

  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const { decision, comment } = body as {
    decision?: 'approved' | 'rejected'
    comment?: string
  }

  if (!decision || (decision !== 'approved' && decision !== 'rejected')) {
    return NextResponse.json({ error: 'decision must be approved or rejected' }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // 1. Fetch the request and its current step
    const { rows: reqs } = await client.query(
      `SELECT r.id, r.workflow_id, r.current_step_order, r.status,
              r.workspace_id, r.requester_id, r.title,
              s.approver_user_id, s.approver_role
       FROM aaelink.approval_requests r
       JOIN aaelink.workflow_steps s ON s.workflow_id = r.workflow_id AND s.step_order = r.current_step_order
       WHERE r.id = $1 FOR UPDATE`,
      [requestId]
    )

    const request = reqs[0]
    if (!request) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }

    if (request.status !== 'pending') {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Request is no longer pending' }, { status: 400 })
    }

    // 2. Authorize the user (are they the assigned user or do they have the required role?)
    const { rows: uRows } = await client.query(`SELECT platform_role FROM aaelink.users WHERE id = $1`, [userId])
    const role = uRows[0]?.platform_role || ''

    const isAuthorized = 
      request.approver_user_id === userId || 
      (request.approver_role && request.approver_role === role)

    if (!isAuthorized) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Forbidden. You are not assigned to review this step.' }, { status: 403 })
    }

    const now = Date.now()

    // 3. Record the review
    const reviewId = randomUUID()
    await client.query(
      `INSERT INTO aaelink.approval_reviews (id, request_id, step_order, reviewer_id, decision, comment, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [reviewId, requestId, request.current_step_order, userId, decision, comment || '', now]
    )

    // 3b. Record the audit log
    await client.query(
      `INSERT INTO aaelink.audit_log (id, workspace_id, actor_id, actor_role, action, resource_kind, resource_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, 'approval.review', 'approval_request', $5, $6, $7)`,
      [randomUUID(), request.workspace_id, userId, role, requestId, JSON.stringify({ decision, step_order: request.current_step_order, comment: comment || '' }), now]
    )

    // 4. Update the request status and notify
    if (decision === 'rejected') {
      // Rejection immediately ends the workflow
      await client.query(
        `UPDATE aaelink.approval_requests SET status = 'rejected', updated_at = $1 WHERE id = $2`,
        [now, requestId]
      )
      
      // Notify requester
      await client.query(
        `INSERT INTO aaelink.notifications (id, user_id, kind, title, body, workspace_id, channel_id, message_id, ticket_id, read_at, created_at)
         VALUES ($1, $2, 'approval', 'Request Rejected', $3, $4, NULL, NULL, NULL, 0, $5)`,
        [randomUUID(), request.requester_id, `Your request "${request.title}" has been rejected.`, request.workspace_id, now]
      )

    } else {
      // If approved, check if there's a next step
      const { rows: nextSteps } = await client.query(
        `SELECT step_order, approver_user_id, approver_role FROM aaelink.workflow_steps 
         WHERE workflow_id = $1 AND step_order > $2 
         ORDER BY step_order ASC LIMIT 1`,
        [request.workflow_id, request.current_step_order]
      )

      if (nextSteps.length > 0) {
        // Move to next step
        const nextStep = nextSteps[0]
        await client.query(
          `UPDATE aaelink.approval_requests SET current_step_order = $1, updated_at = $2 WHERE id = $3`,
          [nextStep.step_order, now, requestId]
        )
        
        // Notify requester of progress
        await client.query(
          `INSERT INTO aaelink.notifications (id, user_id, kind, title, body, workspace_id, channel_id, message_id, ticket_id, read_at, created_at)
           VALUES ($1, $2, 'approval', 'Request Progress', $3, $4, NULL, NULL, NULL, 0, $5)`,
          [randomUUID(), request.requester_id, `Your request "${request.title}" was approved at step ${request.current_step_order} and moved to the next reviewer.`, request.workspace_id, now]
        )

        // Notify new approver(s)
        let notifyUserIds: string[] = []
        if (nextStep.approver_user_id) {
          notifyUserIds.push(nextStep.approver_user_id)
        } else if (nextStep.approver_role) {
          const { rows: users } = await client.query(
            `SELECT id FROM aaelink.users WHERE platform_role = $1`,
            [nextStep.approver_role]
          )
          notifyUserIds = users.map(u => u.id)
        }

        for (const targetUserId of notifyUserIds) {
          await client.query(
            `INSERT INTO aaelink.notifications (id, user_id, kind, title, body, workspace_id, channel_id, message_id, ticket_id, read_at, created_at)
             VALUES ($1, $2, 'approval', 'New Approval Request', $3, $4, NULL, NULL, NULL, 0, $5)`,
            [randomUUID(), targetUserId, `You have a new request pending approval: ${request.title}`, request.workspace_id, now]
          )
        }

      } else {
        // All steps completed, workflow is approved
        await client.query(
          `UPDATE aaelink.approval_requests SET status = 'approved', updated_at = $1 WHERE id = $2`,
          [now, requestId]
        )

        // Notify requester
        await client.query(
          `INSERT INTO aaelink.notifications (id, user_id, kind, title, body, workspace_id, channel_id, message_id, ticket_id, read_at, created_at)
           VALUES ($1, $2, 'approval', 'Request Approved', $3, $4, NULL, NULL, NULL, 0, $5)`,
          [randomUUID(), request.requester_id, `Your request "${request.title}" has been fully approved!`, request.workspace_id, now]
        )
      }
    }

    await client.query('COMMIT')
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    await client.query('ROLLBACK')
    console.error('Error processing approval review:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  } finally {
    client.release()
  }
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/approvals/requests/:id/review', _POST)
