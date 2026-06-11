import { randomUUID } from 'crypto'
import type { Pool } from 'pg'
import { writeAuditLog } from '@/lib/enterprise/auditLog'

/**
 * Workspace invite request management.
 *
 * Users can request to join a workspace. Admins approve or deny.
 * Old requests auto-expire.
 */

export type RequestStatus = 'pending' | 'approved' | 'denied' | 'expired'

export interface InviteRequest {
  id: string
  workspace_id: string
  email: string
  requester_id: string
  status: RequestStatus
  reviewer_id: string | null
  reviewed_at: number | null
  created_at: number
}

export async function createInviteRequest(
  pool: Pool, workspaceId: string, email: string, requesterId: string
): Promise<InviteRequest> {
  const id = randomUUID()
  const now = Date.now()
  await pool.query(
    `INSERT INTO aaelink.invite_requests (id, workspace_id, email, requester_id, status, created_at)
     VALUES ($1, $2, $3, $4, 'pending', $5)`,
    [id, workspaceId, email, requesterId, now]
  )
  writeAuditLog({ pool, workspaceId, actorId: requesterId, action: 'invite_request.create', resourceKind: 'invite_request', resourceId: id })
  return { id, workspace_id: workspaceId, email, requester_id: requesterId, status: 'pending', reviewer_id: null, reviewed_at: null, created_at: now }
}

export async function approveInviteRequest(
  pool: Pool, requestId: string, reviewerId: string
): Promise<void> {
  const now = Date.now()
  await pool.query(
    `UPDATE aaelink.invite_requests SET status = 'approved', reviewer_id = $1, reviewed_at = $2 WHERE id = $3 AND status = 'pending'`,
    [reviewerId, now, requestId]
  )
  writeAuditLog({ pool, actorId: reviewerId, action: 'invite_request.approve', resourceKind: 'invite_request', resourceId: requestId })
}

export async function denyInviteRequest(
  pool: Pool, requestId: string, reviewerId: string
): Promise<void> {
  const now = Date.now()
  await pool.query(
    `UPDATE aaelink.invite_requests SET status = 'denied', reviewer_id = $1, reviewed_at = $2 WHERE id = $3 AND status = 'pending'`,
    [reviewerId, now, requestId]
  )
  writeAuditLog({ pool, actorId: reviewerId, action: 'invite_request.deny', resourceKind: 'invite_request', resourceId: requestId })
}

export async function listPendingRequests(
  pool: Pool, workspaceId: string
): Promise<InviteRequest[]> {
  const { rows } = await pool.query(
    `SELECT * FROM aaelink.invite_requests WHERE workspace_id = $1 AND status = 'pending' ORDER BY created_at DESC`,
    [workspaceId]
  )
  return rows as InviteRequest[]
}

export async function expireOldRequests(
  pool: Pool, workspaceId: string, daysOld: number
): Promise<number> {
  const cutoff = Date.now() - daysOld * 86_400_000
  const res = await pool.query(
    `UPDATE aaelink.invite_requests SET status = 'expired' WHERE workspace_id = $1 AND status = 'pending' AND created_at < $2`,
    [workspaceId, cutoff]
  )
  return res.rowCount ?? 0
}
