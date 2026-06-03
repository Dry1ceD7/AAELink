/**
 * Integration tests for lib/enterprise/barrierGuard.ts
 *
 * Tests the information barrier enforcement layer against a live Postgres.
 * The module exports functions that prevent communication between users/groups
 * separated by active information barriers (used by message pipeline and
 * channel-join logic).
 *
 * Covers:
 *   - getActiveBarriers: loads all active barriers for a workspace
 *   - checkBarrier: checks if communication between two users is blocked
 *   - isBlocked: checks if a user action on a target channel is blocked
 *   - getBarrierViolationMessage: returns the standard error message
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import {
  getActiveBarriers,
  checkBarrier,
  isBlocked,
  getBarrierViolationMessage,
  InformationBarrier,
} from '@/lib/enterprise/barrierGuard'

let ctx: TestContext
let user1: TestUser
let user2: TestUser
let user3: TestUser
const userIds: string[] = []
const wsIds: string[] = []
const channelIds: string[] = []
const barrierIds: string[] = []

async function mkWorkspace(): Promise<string> {
  const id = `ws-${randomUUID().slice(0, 12)}`
  await ctx.pool.query(
    `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system)
     VALUES ($1, $2, $3, $4, $5, false)`,
    [id, `ws-${id.slice(-6)}`, `Workspace ${id.slice(-6)}`, user1.id, Date.now()]
  )
  wsIds.push(id)
  return id
}

async function mkChannel(wsId: string): Promise<string> {
  const id = randomUUID()
  const now = Date.now()
  await ctx.pool.query(
    `INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, wsId, `channel-${id.slice(0, 8)}`, `Channel ${id.slice(0, 8)}`, 'O', now]
  )
  channelIds.push(id)
  return id
}

async function addChannelMember(channelId: string, userId: string): Promise<void> {
  await ctx.pool.query(
    `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
     VALUES ($1, $2, 'member', $3)
     ON CONFLICT DO NOTHING`,
    [channelId, userId, Date.now()]
  )
}

async function mkBarrier(opts: {
  name: string
  type?: string
  groupA: string[]
  groupB: string[]
  blockDm?: boolean
  blockChannels?: boolean
  blockSearch?: boolean
  blockFileShare?: boolean
}): Promise<string> {
  const id = `barrier-${randomUUID().slice(0, 12)}`
  const now = Date.now()
  await ctx.pool.query(
    `INSERT INTO aaelink.information_barriers
     (id, name, type, description, group_a_ids, group_b_ids,
      block_dm, block_channels, block_search, block_file_share, is_active, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11, $12)`,
    [
      id,
      opts.name,
      opts.type || 'custom',
      `Barrier ${id.slice(-8)}`,
      JSON.stringify(opts.groupA),
      JSON.stringify(opts.groupB),
      opts.blockDm ?? true,
      opts.blockChannels ?? true,
      opts.blockSearch ?? true,
      opts.blockFileShare ?? true,
      user1.id,
      now,
    ]
  )
  barrierIds.push(id)
  return id
}

async function deactivateBarrier(barrierId: string): Promise<void> {
  await ctx.pool.query(
    `UPDATE aaelink.information_barriers SET is_active = false WHERE id = $1`,
    [barrierId]
  )
}

beforeAll(async () => {
  ctx = await createTestContext()
  user1 = await createTestUser(ctx.pool, { role: 'employee' })
  user2 = await createTestUser(ctx.pool, { role: 'employee' })
  user3 = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(user1.id, user2.id, user3.id)
})

beforeEach(async () => {
  // Barriers are global (information_barriers has no workspace column) and
  // getActiveBarriers loads every active row, so rows created by earlier
  // `it` blocks leak into later ones. Clear the table before each test so
  // every test starts with only the barriers it creates itself.
  await ctx.pool.query(`DELETE FROM aaelink.information_barriers`)
})

afterAll(async () => {
  // Delete in dependency order
  if (channelIds.length) {
    await ctx.pool.query(
      `DELETE FROM aaelink.channel_members WHERE channel_id = ANY($1)`,
      [channelIds]
    )
    await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = ANY($1)`, [channelIds])
  }

  if (barrierIds.length) {
    await ctx.pool.query(
      `DELETE FROM aaelink.information_barriers WHERE id = ANY($1)`,
      [barrierIds]
    )
  }

  if (wsIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE workspace_id = ANY($1)`, [
      wsIds,
    ])
    await ctx.pool.query(`DELETE FROM aaelink.workspaces WHERE id = ANY($1)`, [wsIds])
  }

  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('getActiveBarriers', () => {
  it('returns empty list when no barriers exist', async () => {
    const barriers = await getActiveBarriers('ws-test-empty')
    expect(barriers).toEqual([])
  })

  it('loads all active barriers with correct shape', async () => {
    const barrierId = await mkBarrier({
      name: 'Test Barrier',
      type: 'custom',
      groupA: [user1.id, user2.id],
      groupB: [user3.id],
    })

    const barriers = await getActiveBarriers('ws-test')
    expect(barriers.length).toBeGreaterThan(0)

    const barrier = barriers.find((b) => b.id === barrierId)
    expect(barrier).toBeDefined()
    if (barrier) {
      expect(barrier.id).toBe(barrierId)
      expect(barrier.name).toBe('Test Barrier')
      expect(barrier.type).toBe('custom')
      expect(barrier.group_a_ids).toEqual([user1.id, user2.id])
      expect(barrier.group_b_ids).toEqual([user3.id])
      expect(barrier.block_dm).toBe(true)
      expect(barrier.block_channels).toBe(true)
      expect(barrier.block_search).toBe(true)
      expect(barrier.block_file_share).toBe(true)
      expect(barrier.is_active).toBe(true)
    }
  })

  it('excludes inactive barriers from results', async () => {
    const barrierId = await mkBarrier({
      name: 'Inactive Barrier',
      groupA: [user1.id],
      groupB: [user2.id],
    })
    await deactivateBarrier(barrierId)

    const barriers = await getActiveBarriers('ws-test')
    const found = barriers.find((b) => b.id === barrierId)
    expect(found).toBeUndefined()
  })

  it('returns barriers with empty groups', async () => {
    const barrierId = await mkBarrier({
      name: 'Empty Groups Barrier',
      groupA: [],
      groupB: [],
    })

    const barriers = await getActiveBarriers('ws-test')
    const barrier = barriers.find((b) => b.id === barrierId)
    expect(barrier).toBeDefined()
    if (barrier) {
      expect(barrier.group_a_ids).toEqual([])
      expect(barrier.group_b_ids).toEqual([])
    }
  })
})

describe('checkBarrier', () => {
  it('returns null when no barrier blocks the pair', async () => {
    const barrier = await checkBarrier(user1.id, user2.id, 'ws-test')
    expect(barrier).toBeNull()
  })

  it('detects barrier when userA is in group_a and userB is in group_b', async () => {
    const barrierId = await mkBarrier({
      name: 'Barrier A-B',
      groupA: [user1.id],
      groupB: [user2.id],
    })

    const barrier = await checkBarrier(user1.id, user2.id, 'ws-test')
    expect(barrier).not.toBeNull()
    expect(barrier?.id).toBe(barrierId)
  })

  it('detects barrier when userA is in group_b and userB is in group_a (symmetric)', async () => {
    const barrierId = await mkBarrier({
      name: 'Barrier B-A',
      groupA: [user1.id],
      groupB: [user2.id],
    })

    // Reverse the direction
    const barrier = await checkBarrier(user2.id, user1.id, 'ws-test')
    expect(barrier).not.toBeNull()
    expect(barrier?.id).toBe(barrierId)
  })

  it('returns null when both users are in the same group', async () => {
    await mkBarrier({
      name: 'Same Group Barrier',
      groupA: [user1.id, user2.id],
      groupB: [user3.id],
    })

    const barrier = await checkBarrier(user1.id, user2.id, 'ws-test')
    expect(barrier).toBeNull()
  })

  it('returns null when a user is not in any barrier group', async () => {
    await mkBarrier({
      name: 'Excluded User Barrier',
      groupA: [user1.id],
      groupB: [user2.id],
    })

    const barrier = await checkBarrier(user3.id, user1.id, 'ws-test')
    expect(barrier).toBeNull()
  })

  it('returns the first blocking barrier when multiple exist', async () => {
    const barrier1Id = await mkBarrier({
      name: 'First Barrier',
      groupA: [user1.id],
      groupB: [user2.id],
    })
    await mkBarrier({
      name: 'Second Barrier',
      groupA: [user1.id],
      groupB: [user2.id],
    })

    const barrier = await checkBarrier(user1.id, user2.id, 'ws-test')
    expect(barrier).not.toBeNull()
    // Should return the first one encountered
    expect(barrier?.id).toBe(barrier1Id)
  })

  it('ignores inactive barriers', async () => {
    const barrierId = await mkBarrier({
      name: 'Initially Active',
      groupA: [user1.id],
      groupB: [user2.id],
    })
    await deactivateBarrier(barrierId)

    const barrier = await checkBarrier(user1.id, user2.id, 'ws-test')
    expect(barrier).toBeNull()
  })
})

describe('isBlocked', () => {
  it('returns false when no barrier blocks the restriction', async () => {
    const ws = await mkWorkspace()
    const channel = await mkChannel(ws)
    await addChannelMember(channel, user2.id)

    const blocked = await isBlocked(user1.id, channel, 'channel')
    expect(blocked).toBe(false)
  })

  it('returns true when barrier blocks channel access with barrier member', async () => {
    const ws = await mkWorkspace()
    const channel = await mkChannel(ws)

    // user3 is a member of the channel
    await addChannelMember(channel, user3.id)

    // Create a barrier that blocks channels
    await mkBarrier({
      name: 'Channel Block Barrier',
      groupA: [user1.id],
      groupB: [user3.id],
      blockChannels: true,
      blockDm: false,
      blockSearch: false,
      blockFileShare: false,
    })

    const blocked = await isBlocked(user1.id, channel, 'channel')
    expect(blocked).toBe(true)
  })

  it('respects the restriction type (dm vs channel)', async () => {
    const ws = await mkWorkspace()
    const channel = await mkChannel(ws)
    await addChannelMember(channel, user2.id)

    // Barrier blocks DM but not channels
    await mkBarrier({
      name: 'DM Only Barrier',
      groupA: [user1.id],
      groupB: [user2.id],
      blockDm: true,
      blockChannels: false,
      blockSearch: false,
      blockFileShare: false,
    })

    // Should be blocked for DM
    const dmBlocked = await isBlocked(user1.id, channel, 'dm')
    expect(dmBlocked).toBe(true)

    // Should NOT be blocked for channel
    const channelBlocked = await isBlocked(user1.id, channel, 'channel')
    expect(channelBlocked).toBe(false)
  })

  it('handles search restriction', async () => {
    const ws = await mkWorkspace()
    const channel = await mkChannel(ws)
    await addChannelMember(channel, user2.id)

    await mkBarrier({
      name: 'Search Block Barrier',
      groupA: [user1.id],
      groupB: [user2.id],
      blockDm: false,
      blockChannels: false,
      blockSearch: true,
      blockFileShare: false,
    })

    const blocked = await isBlocked(user1.id, channel, 'search')
    expect(blocked).toBe(true)
  })

  it('handles file_share restriction', async () => {
    const ws = await mkWorkspace()
    const channel = await mkChannel(ws)
    await addChannelMember(channel, user3.id)

    await mkBarrier({
      name: 'File Share Block Barrier',
      groupA: [user1.id],
      groupB: [user3.id],
      blockDm: false,
      blockChannels: false,
      blockSearch: false,
      blockFileShare: true,
    })

    const blocked = await isBlocked(user1.id, channel, 'file_share')
    expect(blocked).toBe(true)
  })

  it('returns false when no matching barrier has the restriction enabled', async () => {
    const ws = await mkWorkspace()
    const channel = await mkChannel(ws)
    await addChannelMember(channel, user2.id)

    // Barrier does not block channels
    await mkBarrier({
      name: 'No Block Barrier',
      groupA: [user1.id],
      groupB: [user2.id],
      blockDm: false,
      blockChannels: false,
      blockSearch: false,
      blockFileShare: false,
    })

    const blocked = await isBlocked(user1.id, channel, 'channel')
    expect(blocked).toBe(false)
  })

  it('returns false when user is not in any barrier group', async () => {
    const ws = await mkWorkspace()
    const channel = await mkChannel(ws)
    await addChannelMember(channel, user2.id)

    await mkBarrier({
      name: 'Excluded User Barrier',
      groupA: [user2.id],
      groupB: [user3.id],
      blockChannels: true,
    })

    const blocked = await isBlocked(user1.id, channel, 'channel')
    expect(blocked).toBe(false)
  })

  it('returns false when channel has no other members', async () => {
    const ws = await mkWorkspace()
    const channel = await mkChannel(ws)

    await mkBarrier({
      name: 'Empty Channel Barrier',
      groupA: [user1.id],
      groupB: [user2.id],
      blockChannels: true,
    })

    const blocked = await isBlocked(user1.id, channel, 'channel')
    expect(blocked).toBe(false)
  })

  it('ignores the target user themselves in channel members', async () => {
    const ws = await mkWorkspace()
    const channel = await mkChannel(ws)

    // user1 is the only member
    await addChannelMember(channel, user1.id)

    await mkBarrier({
      name: 'Self Block Barrier',
      groupA: [user1.id],
      groupB: [user1.id],
      blockChannels: true,
    })

    const blocked = await isBlocked(user1.id, channel, 'channel')
    expect(blocked).toBe(false)
  })

  it('returns true when multiple members trigger the barrier', async () => {
    const ws = await mkWorkspace()
    const channel = await mkChannel(ws)

    // Add two members from the opposite group
    await addChannelMember(channel, user2.id)
    await addChannelMember(channel, user3.id)

    await mkBarrier({
      name: 'Multi Member Barrier',
      groupA: [user1.id],
      groupB: [user2.id, user3.id],
      blockChannels: true,
    })

    const blocked = await isBlocked(user1.id, channel, 'channel')
    expect(blocked).toBe(true)
  })

  it('handles non-existent channel gracefully', async () => {
    const blocked = await isBlocked(user1.id, 'channel-does-not-exist', 'channel')
    expect(blocked).toBe(false)
  })
})

describe('getBarrierViolationMessage', () => {
  it('returns a non-empty string', () => {
    const message = getBarrierViolationMessage()
    expect(typeof message).toBe('string')
    expect(message.length).toBeGreaterThan(0)
  })

  it('returns a consistent message', () => {
    const msg1 = getBarrierViolationMessage()
    const msg2 = getBarrierViolationMessage()
    expect(msg1).toBe(msg2)
  })

  it('mentions information barrier', () => {
    const message = getBarrierViolationMessage()
    expect(message.toLowerCase()).toContain('barrier')
  })

  it('is user-facing and clear', () => {
    const message = getBarrierViolationMessage()
    // Should be professional and not expose internals
    expect(message).not.toContain('database')
    expect(message).not.toContain('error')
    expect(message).toMatch(/[.!?]$/)
  })
})

describe('round-trip barrier workflows', () => {
  it('creates, retrieves, updates, and disables a barrier', async () => {
    // Create
    const barrierId = await mkBarrier({
      name: 'Round Trip Barrier',
      groupA: [user1.id],
      groupB: [user2.id],
    })

    // Retrieve and verify
    let barriers = await getActiveBarriers('ws-test')
    let barrier = barriers.find((b) => b.id === barrierId)
    expect(barrier).toBeDefined()
    expect(barrier?.is_active).toBe(true)

    // Verify blocking
    let checkResult = await checkBarrier(user1.id, user2.id, 'ws-test')
    expect(checkResult).not.toBeNull()

    // Deactivate
    await deactivateBarrier(barrierId)

    // Verify removal from active list
    barriers = await getActiveBarriers('ws-test')
    barrier = barriers.find((b) => b.id === barrierId)
    expect(barrier).toBeUndefined()

    // Verify no longer blocking
    checkResult = await checkBarrier(user1.id, user2.id, 'ws-test')
    expect(checkResult).toBeNull()
  })

  it('multiple barriers can coexist and be checked independently', async () => {
    const barrier1Id = await mkBarrier({
      name: 'Barrier 1',
      groupA: [user1.id],
      groupB: [user2.id],
      blockDm: true,
      blockChannels: false,
    })

    const barrier2Id = await mkBarrier({
      name: 'Barrier 2',
      groupA: [user1.id],
      groupB: [user3.id],
      blockDm: false,
      blockChannels: true,
    })

    // Both should be active
    const barriers = await getActiveBarriers('ws-test')
    expect(barriers.find((b) => b.id === barrier1Id)).toBeDefined()
    expect(barriers.find((b) => b.id === barrier2Id)).toBeDefined()

    // Check different pairs
    const b1Check = await checkBarrier(user1.id, user2.id, 'ws-test')
    expect(b1Check?.id).toBe(barrier1Id)

    const b2Check = await checkBarrier(user1.id, user3.id, 'ws-test')
    expect(b2Check?.id).toBe(barrier2Id)
  })
})
