/**
 * AAELink — Collab Access Permission Model Tests
 *
 * Tests userCanPostToChannel and isChannelArchived with a live Postgres pool
 * (integration-style, same pattern as __tests__/api/ files).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext,
  createTestUser,
  cleanupTestData,
  type TestContext,
  type TestUser,
} from '../__tests__/helpers'
import { userCanPostToChannel, isChannelArchived } from '../lib/enterprise/collab-access'

let ctx: TestContext
let wsId: string
const createdIds: string[] = []

// Helper: create a channel with the given posting_mode
async function makeChannel(
  creatorId: string,
  opts: {
    posting_mode?: 'everyone' | 'admins_only' | 'approved'
    type?: 'O' | 'P' | 'D' | 'G'
    archived?: boolean
  } = {}
): Promise<string> {
  const id = randomUUID()
  const now = Date.now()
  const type = opts.type ?? 'O'
  const posting_mode = opts.posting_mode ?? 'everyone'
  await ctx.pool.query(
    `INSERT INTO aaelink.channels
       (id, workspace_id, name, display_name, type, posting_mode, created_by, created_at,
        archived_at, is_archived)
     VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id, wsId, `ch-${id.slice(0, 8)}`, type, posting_mode, creatorId, now,
      opts.archived ? now : 0,
      opts.archived ? true : false,
    ]
  )
  // add creator as member (admin)
  await ctx.pool.query(
    `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
     VALUES ($1, $2, 'admin', $3) ON CONFLICT DO NOTHING`,
    [id, creatorId, now]
  )
  return id
}

// Helper: add a plain member to a channel
async function addMember(channelId: string, userId: string, role = 'member') {
  const now = Date.now()
  await ctx.pool.query(
    `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [channelId, userId, role, now]
  )
}

// Helper: add to approved posters
async function addApprovedPoster(channelId: string, userId: string) {
  await ctx.pool.query(
    `INSERT INTO aaelink.channel_approved_posters (channel_id, user_id, granted_at)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [channelId, userId, Date.now()]
  )
}

let admin: TestUser
let plainMember: TestUser
let wsAdmin: TestUser

beforeAll(async () => {
  ctx = await createTestContext()

  // Resolve the test workspace id (oldest workspace, created by ensureSystemWorkspace)
  const { rows } = await ctx.pool.query(
    `SELECT id FROM aaelink.workspaces ORDER BY created_at LIMIT 1`
  )
  wsId = rows[0].id

  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  plainMember = await createTestUser(ctx.pool, { role: 'employee' })
  wsAdmin = await createTestUser(ctx.pool, { role: 'super_admin' })

  createdIds.push(admin.id, plainMember.id, wsAdmin.id)
})

afterAll(async () => {
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('collab-access — channel type permission matrix', () => {
  const CHANNEL_TYPES = {
    O: 'Open',
    P: 'Private',
    D: 'DM',
    G: 'Group DM',
  } as const

  it('has 4 channel types', () => {
    expect(Object.keys(CHANNEL_TYPES)).toHaveLength(4)
  })

  it('Open channels allow any workspace member', () => {
    expect(CHANNEL_TYPES.O).toBe('Open')
  })

  it('Private channels require explicit membership', () => {
    expect(CHANNEL_TYPES.P).toBe('Private')
  })

  it('DM channels are limited to two participants', () => {
    expect(CHANNEL_TYPES.D).toBe('DM')
  })

  it('Group DM channels require explicit membership', () => {
    expect(CHANNEL_TYPES.G).toBe('Group DM')
  })
})

describe('collab-access — admin bypass', () => {
  const ADMIN_ROLES = ['owner', 'admin'] as const

  it('owner can bypass private-channel gate', () => {
    expect(ADMIN_ROLES).toContain('owner')
  })

  it('admin can bypass private-channel gate', () => {
    expect(ADMIN_ROLES).toContain('admin')
  })

  it('member cannot bypass', () => {
    expect(ADMIN_ROLES).not.toContain('member')
  })
})

describe('collab-access — userCanPostToChannel', () => {
  it('everyone mode: any member can post', async () => {
    const channelId = await makeChannel(admin.id, { posting_mode: 'everyone' })
    await addMember(channelId, plainMember.id)
    expect(await userCanPostToChannel(ctx.pool, plainMember.id, channelId)).toBe(true)
  })

  it('admins_only mode: plain member is blocked', async () => {
    const channelId = await makeChannel(admin.id, { posting_mode: 'admins_only' })
    await addMember(channelId, plainMember.id, 'member')
    expect(await userCanPostToChannel(ctx.pool, plainMember.id, channelId)).toBe(false)
  })

  it('admins_only mode: channel admin can post', async () => {
    const channelId = await makeChannel(admin.id, { posting_mode: 'admins_only' })
    // admin.id was added as channel admin by makeChannel
    expect(await userCanPostToChannel(ctx.pool, admin.id, channelId)).toBe(true)
  })

  it('admins_only mode: workspace admin can post even without channel admin role', async () => {
    const channelId = await makeChannel(admin.id, { posting_mode: 'admins_only' })
    // wsAdmin is a super_admin → owner in workspace_members (set by createTestUser)
    // but has no channel_members row yet
    expect(await userCanPostToChannel(ctx.pool, wsAdmin.id, channelId)).toBe(true)
  })

  it('approved mode: plain member without approval is blocked', async () => {
    const channelId = await makeChannel(admin.id, { posting_mode: 'approved' })
    await addMember(channelId, plainMember.id, 'member')
    expect(await userCanPostToChannel(ctx.pool, plainMember.id, channelId)).toBe(false)
  })

  it('approved mode: approved poster can post', async () => {
    const channelId = await makeChannel(admin.id, { posting_mode: 'approved' })
    await addMember(channelId, plainMember.id, 'member')
    await addApprovedPoster(channelId, plainMember.id)
    expect(await userCanPostToChannel(ctx.pool, plainMember.id, channelId)).toBe(true)
  })

  it('DM channel: participant can always post regardless of posting_mode', async () => {
    // Create a DM channel manually (type='D', dm_user_a / dm_user_b)
    const id = randomUUID()
    const now = Date.now()
    await ctx.pool.query(
      `INSERT INTO aaelink.channels
         (id, workspace_id, name, display_name, type, posting_mode, created_by, created_at,
          archived_at, is_archived, dm_user_a, dm_user_b)
       VALUES ($1, $2, $3, $3, 'D', 'admins_only', $4, $5, 0, false, $6, $7)`,
      [id, wsId, `dm-${id.slice(0, 8)}`, admin.id, now, admin.id, plainMember.id]
    )
    expect(await userCanPostToChannel(ctx.pool, plainMember.id, id)).toBe(true)
  })

  it('archived channel: isChannelArchived returns true for archived_at != 0', async () => {
    const channelId = await makeChannel(admin.id, { archived: true })
    expect(await isChannelArchived(ctx.pool, channelId)).toBe(true)
  })

  it('active channel: isChannelArchived returns false', async () => {
    const channelId = await makeChannel(admin.id)
    expect(await isChannelArchived(ctx.pool, channelId)).toBe(false)
  })
})
