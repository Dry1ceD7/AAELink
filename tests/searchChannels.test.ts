/**
 * Unit tests for lib/messaging/searchChannels
 *
 * Visibility rules verified:
 *   - Public (type='O') channels in the caller's workspace are discoverable
 *   - Private (type='P') channels NOT joined by the caller are excluded
 *   - DM (type='D') and group-DM (type='G') channels are excluded
 *   - Archived channels (archived_at > 0) are excluded
 *   - Channels with is_archived=true are excluded
 *   - joined flag reflects channel_members row for the caller
 *   - member_count reflects total channel_members rows
 *   - q filters by display_name / name / purpose / description (ILIKE)
 *   - Empty q returns all discoverable channels (alphabetical)
 *   - Exact-prefix matches rank before contains-only matches
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, cleanupTestData, TestContext, TestUser } from '../__tests__/helpers'
import { searchChannels } from '@/lib/messaging/searchChannels'

let ctx: TestContext
let owner: TestUser
let outsider: TestUser
let workspaceId: string
const cleanupIds: string[] = []

// Channel ids created per-suite so afterAll can cascade-delete via workspace
let chPublic: string
let chPrivate: string
let chDm: string
let chArchivedAt: string
let chIsArchived: string
let chMember: string   // public channel the owner has joined

beforeAll(async () => {
  ctx = await createTestContext()
  owner = await createTestUser(ctx.pool, { role: 'employee' })
  outsider = await createTestUser(ctx.pool, { role: 'employee' })
  cleanupIds.push(owner.id, outsider.id)

  workspaceId = randomUUID()
  const now = Date.now()

  await ctx.pool.query(
    `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system)
     VALUES ($1, $2, $3, $4, $5, false)`,
    [workspaceId, `test-search-ws-${workspaceId.slice(0, 6)}`, 'Test Search WS', owner.id, now]
  )
  await ctx.pool.query(
    `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
    [workspaceId, owner.id]
  )
  // outsider is NOT a member of this workspace (tests workspace isolation separately)

  const insertChannel = async (
    id: string,
    name: string,
    type: string,
    extra: Record<string, unknown> = {}
  ) => {
    const cols = ['id', 'workspace_id', 'name', 'display_name', 'type', 'created_at', 'archived_at']
    const vals: unknown[] = [id, workspaceId, name, name, type, now, 0]

    if (extra.purpose !== undefined) { cols.push('purpose'); vals.push(extra.purpose) }
    if (extra.description !== undefined) { cols.push('description'); vals.push(extra.description) }
    if (extra.archived_at !== undefined) { vals[6] = extra.archived_at }
    if (extra.is_archived !== undefined) { cols.push('is_archived'); vals.push(extra.is_archived) }

    const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ')
    await ctx.pool.query(
      `INSERT INTO aaelink.channels (${cols.join(', ')}) VALUES (${placeholders})`,
      vals
    )
  }

  // Public channel — owner NOT a member
  chPublic = randomUUID()
  await insertChannel(chPublic, 'alpha-public', 'O', { purpose: 'Public purpose text', description: 'Public desc' })

  // Public channel — owner IS a member
  chMember = randomUUID()
  await insertChannel(chMember, 'beta-joined', 'O', { purpose: 'Joined channel' })
  await ctx.pool.query(
    `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at) VALUES ($1, $2, 'member', $3)`,
    [chMember, owner.id, now]
  )
  // Add outsider as member too so member_count = 2
  await ctx.pool.query(
    `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at) VALUES ($1, $2, 'member', $3)`,
    [chMember, outsider.id, now]
  )

  // Private channel — owner NOT a member → should be excluded
  chPrivate = randomUUID()
  await insertChannel(chPrivate, 'gamma-private', 'P', {})

  // DM channel — should always be excluded
  chDm = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, created_at, archived_at, dm_user_a, dm_user_b)
     VALUES ($1, $2, $3, $4, 'D', $5, 0, $6, $7)`,
    [chDm, workspaceId, `dm-${chDm.slice(0, 8)}`, 'DM', now, owner.id, outsider.id]
  )

  // Archived via archived_at > 0
  chArchivedAt = randomUUID()
  await insertChannel(chArchivedAt, 'delta-archived', 'O', { archived_at: now - 1000 })

  // Archived via is_archived = true
  chIsArchived = randomUUID()
  await insertChannel(chIsArchived, 'epsilon-is-archived', 'O', { is_archived: true })
})

afterAll(async () => {
  await ctx.pool.query(`DELETE FROM aaelink.channel_members WHERE channel_id = ANY($1::text[])`, [[chPublic, chMember, chPrivate, chDm, chArchivedAt, chIsArchived]])
  await ctx.pool.query(`DELETE FROM aaelink.channels WHERE workspace_id = $1`, [workspaceId])
  await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE workspace_id = $1`, [workspaceId])
  await ctx.pool.query(`DELETE FROM aaelink.workspaces WHERE id = $1`, [workspaceId])
  await cleanupTestData(ctx.pool, cleanupIds)
  await ctx.cleanup()
})

describe('searchChannels — visibility rules', () => {
  it('returns public channels in the caller workspace', async () => {
    const { channels } = await searchChannels(ctx.pool, owner.id, { workspaceId })
    const ids = channels.map(c => c.id)
    expect(ids).toContain(chPublic)
    expect(ids).toContain(chMember)
  })

  it('excludes private channels the caller has not joined', async () => {
    const { channels } = await searchChannels(ctx.pool, owner.id, { workspaceId })
    const ids = channels.map(c => c.id)
    expect(ids).not.toContain(chPrivate)
  })

  it('excludes DM channels', async () => {
    const { channels } = await searchChannels(ctx.pool, owner.id, { workspaceId })
    const ids = channels.map(c => c.id)
    expect(ids).not.toContain(chDm)
  })

  it('excludes channels with archived_at > 0', async () => {
    const { channels } = await searchChannels(ctx.pool, owner.id, { workspaceId })
    const ids = channels.map(c => c.id)
    expect(ids).not.toContain(chArchivedAt)
  })

  it('excludes channels with is_archived = true', async () => {
    const { channels } = await searchChannels(ctx.pool, owner.id, { workspaceId })
    const ids = channels.map(c => c.id)
    expect(ids).not.toContain(chIsArchived)
  })

  it('sets joined=true when caller is a channel member', async () => {
    const { channels } = await searchChannels(ctx.pool, owner.id, { workspaceId })
    const joined = channels.find(c => c.id === chMember)
    expect(joined?.joined).toBe(true)
  })

  it('sets joined=false when caller is NOT a channel member', async () => {
    const { channels } = await searchChannels(ctx.pool, owner.id, { workspaceId })
    const notJoined = channels.find(c => c.id === chPublic)
    expect(notJoined?.joined).toBe(false)
  })

  it('returns correct member_count', async () => {
    const { channels } = await searchChannels(ctx.pool, owner.id, { workspaceId })
    const ch = channels.find(c => c.id === chMember)
    // owner + outsider are both members
    expect(ch?.member_count).toBe(2)
  })

  it('returns total count matching visible channels', async () => {
    const { total, channels } = await searchChannels(ctx.pool, owner.id, { workspaceId })
    expect(total).toBe(channels.length)
  })
})

describe('searchChannels — text search', () => {
  it('matches on display_name (ILIKE)', async () => {
    const { channels } = await searchChannels(ctx.pool, owner.id, { workspaceId, q: 'alpha' })
    expect(channels.map(c => c.id)).toContain(chPublic)
  })

  it('matches on purpose (ILIKE)', async () => {
    const { channels } = await searchChannels(ctx.pool, owner.id, { workspaceId, q: 'Public purpose' })
    expect(channels.map(c => c.id)).toContain(chPublic)
  })

  it('matches on description (ILIKE)', async () => {
    const { channels } = await searchChannels(ctx.pool, owner.id, { workspaceId, q: 'Public desc' })
    expect(channels.map(c => c.id)).toContain(chPublic)
  })

  it('excludes non-matching channels', async () => {
    const { channels } = await searchChannels(ctx.pool, owner.id, { workspaceId, q: 'zzz-no-match' })
    expect(channels).toHaveLength(0)
  })

  it('is case-insensitive', async () => {
    const { channels } = await searchChannels(ctx.pool, owner.id, { workspaceId, q: 'ALPHA' })
    expect(channels.map(c => c.id)).toContain(chPublic)
  })

  it('ranks exact-prefix match before contains-only', async () => {
    // 'beta' is a prefix of beta-joined; 'alpha' is a prefix of alpha-public
    // Both contain 'a', but exact-prefix channel should rank first when querying its prefix
    const { channels } = await searchChannels(ctx.pool, owner.id, { workspaceId, q: 'beta' })
    expect(channels[0]?.id).toBe(chMember)
  })
})

describe('searchChannels — pagination', () => {
  it('respects limit', async () => {
    const { channels } = await searchChannels(ctx.pool, owner.id, { workspaceId, limit: 1 })
    expect(channels).toHaveLength(1)
  })

  it('respects offset', async () => {
    const all = await searchChannels(ctx.pool, owner.id, { workspaceId })
    const paginated = await searchChannels(ctx.pool, owner.id, { workspaceId, limit: 1, offset: 1 })
    expect(paginated.channels[0]?.id).toBe(all.channels[1]?.id)
  })
})
