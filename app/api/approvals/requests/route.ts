import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'

export async function GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspaceId = req.nextUrl.searchParams.get('workspace_id')
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 })

  // We want to return two sets of requests:
  // 1. "My Requests" (where requester_id = session.user_id)
  // 2. "Pending My Approval" (where status = 'pending' and the current step assigns to me or my role)

  try {
    const { rows: myRequests } = await pool.query(
      `SELECT r.*, w.name as workflow_name,
              COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.username) as requester_name
       FROM aaelink.approval_requests r
       LEFT JOIN aaelink.workflows w ON r.workflow_id = w.id
       LEFT JOIN aaelink.users u ON r.requester_id = u.id
       WHERE r.workspace_id = $1 AND r.requester_id = $2
       ORDER BY r.created_at DESC`,
      [workspaceId, userId]
    )

    // For "pending my approval", we check if the current step requires this user.
    // E.g., approver_user_id = me OR approver_role = my_platform_role
    const { rows: uRows } = await pool.query(`SELECT platform_role FROM aaelink.users WHERE id = $1`, [userId])
    const role = uRows[0]?.platform_role || ''

    const { rows: pendingApprovals } = await pool.query(
      `SELECT r.*, w.name as workflow_name, s.approver_user_id, s.approver_role,
              COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.username) as requester_name
       FROM aaelink.approval_requests r
       JOIN aaelink.workflows w ON r.workflow_id = w.id
       JOIN aaelink.workflow_steps s ON s.workflow_id = w.id AND s.step_order = r.current_step_order
       JOIN aaelink.users u ON r.requester_id = u.id
       WHERE r.workspace_id = $1 
         AND r.status = 'pending'
         AND (s.approver_user_id = $2 OR s.approver_role = $3)
       ORDER BY r.created_at DESC`,
      [workspaceId, userId, role]
    )

    return NextResponse.json({ my_requests: myRequests, pending_approvals: pendingApprovals })
  } catch (err) {
    console.error('Error fetching approval requests:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const { workspace_id, workflow_id, title, description } = body as {
    workspace_id?: string
    workflow_id?: string
    title?: string
    description?: string
  }

  if (!workspace_id || !workflow_id || !title || !description) {
    return NextResponse.json({ error: 'workspace_id, workflow_id, title, and description are required' }, { status: 400 })
  }

  const requestId = randomUUID()
  const now = Date.now()

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `INSERT INTO aaelink.approval_requests (id, workspace_id, workflow_id, requester_id, title, description, status, current_step_order, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', 1, $7, $8)`,
      [requestId, workspace_id, workflow_id, userId, title, description, now, now]
    )

    // Notify approver(s) of Step 1
    const { rows: steps } = await client.query(
      `SELECT approver_user_id, approver_role FROM aaelink.workflow_steps 
       WHERE workflow_id = $1 AND step_order = 1`,
      [workflow_id]
    )
    if (steps.length > 0) {
      const step = steps[0]
      let notifyUserIds: string[] = []
      
      if (step.approver_user_id) {
        notifyUserIds.push(step.approver_user_id)
      } else if (step.approver_role) {
        const { rows: users } = await client.query(
          `SELECT id FROM aaelink.users WHERE platform_role = $1`,
          [step.approver_role]
        )
        notifyUserIds = users.map(u => u.id)
      }

      // Insert notifications
      for (const targetUserId of notifyUserIds) {
        await client.query(
          `INSERT INTO aaelink.notifications (id, user_id, kind, title, body, workspace_id, channel_id, message_id, ticket_id, read_at, created_at)
           VALUES ($1, $2, 'approval', 'New Approval Request', $3, $4, NULL, NULL, NULL, 0, $5)`,
          [randomUUID(), targetUserId, `You have a new request pending approval: ${title}`, workspace_id, now]
        )
      }
    }

    await client.query('COMMIT')
    return NextResponse.json({ success: true, id: requestId })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Error creating approval request:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  } finally {
    client.release()
  }
}
