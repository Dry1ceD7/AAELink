/**
 * Integration tests for invite request management.
 *
 * Exercises the invite request lib layer (lib/enterprise/inviteRequests.ts)
 * against a live Postgres. Tests create requests, list pending, approve/deny,
 * and expire old requests.
 *
 * Covers:
 *   - createInviteRequest: create a new pending request
 *   - listPendingRequests: list pending requests for a workspace
 *   - approveInviteRequest: approve a pending request
 *   - denyInviteRequest: deny a pending request
 *   - expireOldRequests: mark old pending requests as expired
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import {
  createInviteRequest,
  listPendingRequests,
  approveInviteRequest,
  denyInviteRequest,
  expireOldRequests,
  type InviteRequest,
} from '@/lib/enterprise/inviteRequests'

let ctx: TestContext
let user1: TestUser
let user2: TestUser
const userIds: string[] = []
const orgIds: string[] = []
const wsIds: string[] = []
const requestIds: string[] = []

async function mkOrg(): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.organizations (id, name, domain) VALUES ($1, $2, $3)`,
    [id, `Org ${id.slice(0, 6)}`, `${id.slice(0, 8)}.example.test`]
  )
  orgIds.push(id)
  return id
}

async function mkWorkspace(opts: { orgId: string | null }): Promise<string> {
  const id = `ws-${randomUUID().slice(0, 12)}`
  await ctx.pool.query(
    `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system, org_id)
     VALUES ($1, $1, $2, $3, $4, false, $5)`,
    [id, `WS ${id.slice(-6)}`, user1.id, Date.now(), opts.orgId]
  )
  wsIds.push(id)
  return id
}

let org: string
let ws: string

beforeAll(async () => {
  ctx = await createTestContext()
  user1 = await createTestUser(ctx.pool, { role: 'employee' })
  user2 = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(user1.id, user2.id)

  org = await mkOrg()
  ws = await mkWorkspace({ orgId: org })
})

afterAll(async () => {
  // Clean up requests first (FK dependency)
  if (requestIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.invite_requests WHERE id = ANY($1)`, [requestIds])
  }
  // Clean up workspaces
  if (wsIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.workspaces WHERE id = ANY($1)`, [wsIds])
  }
  // Clean up organizations
  if (orgIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.organizations WHERE id = ANY($1)`, [orgIds])
  }
  // Clean up sessions
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  // Clean up users
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('createInviteRequest', () => {
  it('creates a new pending invite request', async () => {
    const req = await createInviteRequest(ctx.pool, ws, 'newuser@example.com', user1.id)
    
    expect(req.id).toBeDefined()
    expect(req.workspace_id).toBe(ws)
    expect(req.email).toBe('newuser@example.com')
    expect(req.requester_id).toBe(user1.id)
    expect(req.status).toBe('pending')
    expect(req.reviewer_id).toBeNull()
    expect(req.reviewed_at).toBeNull()
    expect(typeof req.created_at).toBe('number')
    
    requestIds.push(req.id)

    // Verify it was inserted
    const { rows } = await ctx.pool.query(
      `SELECT * FROM aaelink.invite_requests WHERE id = $1`,
      [req.id]
    )
    expect(rows.length).toBe(1)
    const row = rows[0] as { id: string; status: string; email: string }
    expect(row.status).toBe('pending')
    expect(row.email).toBe('newuser@example.com')
  })

  it('returns correct type with all fields', async () => {
    const req = await createInviteRequest(ctx.pool, ws, 'another@example.com', user1.id)
    requestIds.push(req.id)

    expect(Object.keys(req).sort()).toEqual([
      'created_at',
      'email',
      'id',
      'requester_id',
      'reviewed_at',
      'reviewer_id',
      'status',
      'workspace_id',
    ])
  })
})

describe('listPendingRequests', () => {
  it('lists only pending requests for a workspace', async () => {
    const req1 = await createInviteRequest(ctx.pool, ws, 'pending1@example.com', user1.id)
    const req2 = await createInviteRequest(ctx.pool, ws, 'pending2@example.com', user1.id)
    requestIds.push(req1.id, req2.id)

    const pending = await listPendingRequests(ctx.pool, ws)
    
    expect(pending.length).toBeGreaterThanOrEqual(2)
    const ids = pending.map(r => r.id)
    expect(ids).toContain(req1.id)
    expect(ids).toContain(req2.id)
    
    // All should be pending
    expect(pending.every(r => r.status === 'pending')).toBe(true)
  })

  it('returns empty list when no pending requests', async () => {
    const newWs = await mkWorkspace({ orgId: org })
    const pending = await listPendingRequests(ctx.pool, newWs)
    
    expect(Array.isArray(pending)).toBe(true)
    expect(pending.length).toBe(0)
  })

  it('orders by created_at DESC (most recent first)', async () => {
    const newWs = await mkWorkspace({ orgId: org })
    
    const req1 = await createInviteRequest(ctx.pool, newWs, 'first@example.com', user1.id)
    await new Promise(r => setTimeout(r, 10)) // small delay
    const req2 = await createInviteRequest(ctx.pool, newWs, 'second@example.com', user1.id)
    requestIds.push(req1.id, req2.id)

    const pending = await listPendingRequests(ctx.pool, newWs)
    
    // req2 created after req1, so should come first
    expect(pending[0].id).toBe(req2.id)
    expect(pending[1].id).toBe(req1.id)
  })
})

describe('approveInviteRequest', () => {
  it('updates request status to approved with reviewer info', async () => {
    const req = await createInviteRequest(ctx.pool, ws, 'approve@example.com', user1.id)
    requestIds.push(req.id)
    
    const beforeUpdate = Date.now()
    await approveInviteRequest(ctx.pool, req.id, user2.id)
    const afterUpdate = Date.now()

    // Query to verify
    const { rows } = await ctx.pool.query(
      `SELECT * FROM aaelink.invite_requests WHERE id = $1`,
      [req.id]
    )
    expect(rows.length).toBe(1)
    const row = rows[0] as { status: string; reviewer_id: string; reviewed_at: number }
    expect(row.status).toBe('approved')
    expect(row.reviewer_id).toBe(user2.id)
    expect(Number(row.reviewed_at)).toBeGreaterThanOrEqual(beforeUpdate)
    expect(Number(row.reviewed_at)).toBeLessThanOrEqual(afterUpdate)
  })

  it('only approves if status is pending', async () => {
    const req = await createInviteRequest(ctx.pool, ws, 'pendingonly@example.com', user1.id)
    requestIds.push(req.id)

    // Approve once
    await approveInviteRequest(ctx.pool, req.id, user2.id)

    // Try to approve again (should not change, because it's no longer pending)
    const timeBefore = Date.now()
    await approveInviteRequest(ctx.pool, req.id, user1.id)
    const timeAfter = Date.now()

    const { rows } = await ctx.pool.query(
      `SELECT reviewer_id, reviewed_at FROM aaelink.invite_requests WHERE id = $1`,
      [req.id]
    )
    const row = rows[0] as { reviewer_id: string; reviewed_at: number }
    // Should still be reviewed by user2 (first approver), not user1
    expect(row.reviewer_id).toBe(user2.id)
    // reviewed_at should NOT have been updated by the no-op approve (set at or
    // before timeBefore by user2's original approval; <= tolerates same-ms).
    expect(Number(row.reviewed_at)).toBeLessThanOrEqual(timeBefore)
  })
})

describe('denyInviteRequest', () => {
  it('updates request status to denied with reviewer info', async () => {
    const req = await createInviteRequest(ctx.pool, ws, 'deny@example.com', user1.id)
    requestIds.push(req.id)
    
    const beforeUpdate = Date.now()
    await denyInviteRequest(ctx.pool, req.id, user2.id)
    const afterUpdate = Date.now()

    const { rows } = await ctx.pool.query(
      `SELECT * FROM aaelink.invite_requests WHERE id = $1`,
      [req.id]
    )
    expect(rows.length).toBe(1)
    const row = rows[0] as { status: string; reviewer_id: string; reviewed_at: number }
    expect(row.status).toBe('denied')
    expect(row.reviewer_id).toBe(user2.id)
    expect(Number(row.reviewed_at)).toBeGreaterThanOrEqual(beforeUpdate)
    expect(Number(row.reviewed_at)).toBeLessThanOrEqual(afterUpdate)
  })

  it('only denies if status is pending', async () => {
    const req = await createInviteRequest(ctx.pool, ws, 'denyonce@example.com', user1.id)
    requestIds.push(req.id)

    // Deny once
    await denyInviteRequest(ctx.pool, req.id, user2.id)

    // Try to deny again (should not change)
    const timeBefore = Date.now()
    await denyInviteRequest(ctx.pool, req.id, user1.id)
    const timeAfter = Date.now()

    const { rows } = await ctx.pool.query(
      `SELECT reviewer_id, reviewed_at FROM aaelink.invite_requests WHERE id = $1`,
      [req.id]
    )
    const row = rows[0] as { reviewer_id: string; reviewed_at: number }
    expect(row.reviewer_id).toBe(user2.id)
    // no-op deny must not re-stamp reviewed_at; <= tolerates same-ms.
    expect(Number(row.reviewed_at)).toBeLessThanOrEqual(timeBefore)
  })
})

describe('expireOldRequests', () => {
  it('marks pending requests older than daysOld as expired', async () => {
    const newWs = await mkWorkspace({ orgId: org })
    
    // Create an old request by directly inserting with an old created_at
    const oldReqId = randomUUID()
    const oldTimestamp = Date.now() - 10 * 86_400_000 // 10 days ago
    await ctx.pool.query(
      `INSERT INTO aaelink.invite_requests (id, workspace_id, email, requester_id, status, created_at)
       VALUES ($1, $2, $3, $4, 'pending', $5)`,
      [oldReqId, newWs, 'old@example.com', user1.id, oldTimestamp]
    )
    requestIds.push(oldReqId)

    // Create a recent request
    const newReq = await createInviteRequest(ctx.pool, newWs, 'recent@example.com', user1.id)
    requestIds.push(newReq.id)

    // Expire requests older than 5 days
    const count = await expireOldRequests(ctx.pool, newWs, 5)
    
    expect(count).toBe(1) // Only the old one should be expired

    // Verify old request is expired
    const { rows: oldRows } = await ctx.pool.query(
      `SELECT status FROM aaelink.invite_requests WHERE id = $1`,
      [oldReqId]
    )
    expect((oldRows[0] as { status: string }).status).toBe('expired')

    // Verify recent request is still pending
    const { rows: newRows } = await ctx.pool.query(
      `SELECT status FROM aaelink.invite_requests WHERE id = $1`,
      [newReq.id]
    )
    expect((newRows[0] as { status: string }).status).toBe('pending')
  })

  it('returns the count of expired requests', async () => {
    const newWs = await mkWorkspace({ orgId: org })

    // Create multiple old requests
    const oldReq1Id = randomUUID()
    const oldReq2Id = randomUUID()
    const oldTimestamp = Date.now() - 20 * 86_400_000 // 20 days ago
    
    await ctx.pool.query(
      `INSERT INTO aaelink.invite_requests (id, workspace_id, email, requester_id, status, created_at)
       VALUES ($1, $2, $3, $4, 'pending', $5)`,
      [oldReq1Id, newWs, 'old1@example.com', user1.id, oldTimestamp]
    )
    await ctx.pool.query(
      `INSERT INTO aaelink.invite_requests (id, workspace_id, email, requester_id, status, created_at)
       VALUES ($1, $2, $3, $4, 'pending', $5)`,
      [oldReq2Id, newWs, 'old2@example.com', user1.id, oldTimestamp]
    )
    requestIds.push(oldReq1Id, oldReq2Id)

    const count = await expireOldRequests(ctx.pool, newWs, 7)
    
    expect(count).toBe(2)
  })

  it('ignores non-pending requests when expiring', async () => {
    const newWs = await mkWorkspace({ orgId: org })

    // Create old approved request
    const oldApprovedId = randomUUID()
    const oldTimestamp = Date.now() - 10 * 86_400_000
    await ctx.pool.query(
      `INSERT INTO aaelink.invite_requests (id, workspace_id, email, requester_id, status, reviewer_id, reviewed_at, created_at)
       VALUES ($1, $2, $3, $4, 'approved', $5, $6, $7)`,
      [oldApprovedId, newWs, 'approved@example.com', user1.id, user2.id, Date.now(), oldTimestamp]
    )
    requestIds.push(oldApprovedId)

    // Create old pending request
    const oldPendingId = randomUUID()
    await ctx.pool.query(
      `INSERT INTO aaelink.invite_requests (id, workspace_id, email, requester_id, status, created_at)
       VALUES ($1, $2, $3, $4, 'pending', $5)`,
      [oldPendingId, newWs, 'pending@example.com', user1.id, oldTimestamp]
    )
    requestIds.push(oldPendingId)

    const count = await expireOldRequests(ctx.pool, newWs, 5)
    
    // Only the pending one should be expired
    expect(count).toBe(1)

    // Approved should stay approved
    const { rows: approvedRows } = await ctx.pool.query(
      `SELECT status FROM aaelink.invite_requests WHERE id = $1`,
      [oldApprovedId]
    )
    expect((approvedRows[0] as { status: string }).status).toBe('approved')
  })
})

describe('round-trip workflow', () => {
  it('creates, lists, approves, and verifies status changes', async () => {
    const newWs = await mkWorkspace({ orgId: org })

    // Create
    const req1 = await createInviteRequest(ctx.pool, newWs, 'rtuser1@example.com', user1.id)
    const req2 = await createInviteRequest(ctx.pool, newWs, 'rtuser2@example.com', user1.id)
    const req3 = await createInviteRequest(ctx.pool, newWs, 'rtuser3@example.com', user1.id)
    requestIds.push(req1.id, req2.id, req3.id)

    // List pending (should have all 3)
    let pending = await listPendingRequests(ctx.pool, newWs)
    expect(pending.length).toBe(3)

    // Approve one
    await approveInviteRequest(ctx.pool, req1.id, user2.id)

    // List pending (should have 2)
    pending = await listPendingRequests(ctx.pool, newWs)
    expect(pending.length).toBe(2)
    expect(pending.map(r => r.id)).not.toContain(req1.id)
    expect(pending.map(r => r.id)).toContain(req2.id)
    expect(pending.map(r => r.id)).toContain(req3.id)

    // Deny another
    await denyInviteRequest(ctx.pool, req2.id, user2.id)

    // List pending (should have 1)
    pending = await listPendingRequests(ctx.pool, newWs)
    expect(pending.length).toBe(1)
    expect(pending[0].id).toBe(req3.id)

    // Verify approved request is not pending
    const { rows: req1Row } = await ctx.pool.query(
      `SELECT status FROM aaelink.invite_requests WHERE id = $1`,
      [req1.id]
    )
    expect((req1Row[0] as { status: string }).status).toBe('approved')

    // Verify denied request is not pending
    const { rows: req2Row } = await ctx.pool.query(
      `SELECT status FROM aaelink.invite_requests WHERE id = $1`,
      [req2.id]
    )
    expect((req2Row[0] as { status: string }).status).toBe('denied')
  })
})
