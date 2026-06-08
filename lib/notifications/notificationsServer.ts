import { randomUUID } from 'crypto'
import type { Pool } from 'pg'
import { AAELINK_GLOBAL_WORKSPACE_ID } from '@/lib/constants'
import { userCanReadChannel, filterUsersCanReadChannel } from '@/lib/enterprise/collab-access'
import { filterUsersForNotification } from '@/lib/notifications/notificationPrefs'
import { parseMentionUsernames } from '@/lib/messaging/mentionParse'
import type { BroadcastToken } from '@/lib/messaging/mentionParse'
import { matchKeywords } from '@/lib/notifications/keywords'
import { selectPushTargets, enqueuePush, dropLevelNothing, dropMuted, channelMembersLevelAll } from '@/lib/notifications/pushTargeting'
import { isDndActiveNow } from '@/lib/notifications/dndWindow'

export type NotificationInsertRow = {
  user_id: string
  kind: string
  title: string
  body: string
  workspace_id: string
  channel_id: string | null
  message_id: string | null
  ticket_id: string | null
}

function snippet(text: string, max = 160) {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

export async function insertNotifications(pool: Pool, rows: NotificationInsertRow[]): Promise<void> {
  if (rows.length === 0) return
  const now = Date.now()
  const values: unknown[] = []
  const placeholders: string[] = []
  let i = 0
  for (const r of rows) {
    const id = randomUUID()
    placeholders.push(
      `($${i + 1}, $${i + 2}, $${i + 3}, $${i + 4}, $${i + 5}, $${i + 6}, $${i + 7}, $${i + 8}, $${i + 9}, $${i + 10}, $${i + 11})`
    )
    values.push(
      id,
      r.user_id,
      r.kind,
      r.title,
      r.body,
      r.workspace_id,
      r.channel_id,
      r.message_id,
      r.ticket_id,
      0,
      now
    )
    i += 11
  }
  await pool.query(
    `INSERT INTO aaelink.notifications (id, user_id, kind, title, body, workspace_id, channel_id, message_id, ticket_id, read_at, created_at)
     VALUES ${placeholders.join(', ')}`,
    values
  )
}

/** Resolve @names to user ids in the workspace; excludes authorId. */
export async function resolveMentionTargets(
  pool: Pool,
  workspaceId: string,
  namesLower: string[],
  authorId: string
): Promise<string[]> {
  if (namesLower.length === 0) return []
  const { rows } = await pool.query<{ id: string }>(
    `SELECT u.id FROM aaelink.users u
     INNER JOIN aaelink.workspace_members wm ON wm.user_id = u.id AND wm.workspace_id = $1
     WHERE LOWER(u.username) = ANY($2::text[]) AND u.id <> $3`,
    [workspaceId, namesLower, authorId]
  )
  return rows.map(r => r.id)
}

/**
 * True when an in-app notification for `userId` in `channelId` must be SUPPRESSED
 * at insert time — i.e. never written to aaelink.notifications. Suppressed when:
 *
 *  - the channel is MUTED for the user (channel_notification_prefs.muted = true
 *    for this channel), OR
 *  - the user is currently in an ACTIVE Do-Not-Disturb window, mirroring the
 *    /api/dnd route's `is_active`: an active snooze (snooze_until > now), an
 *    enabled daily schedule whose window contains now (via the shared
 *    isDndActiveNow helper — not duplicated here), OR a manual
 *    user_status.status = 'dnd' that has not expired.
 *
 * Because suppressed rows are never inserted, unread badges naturally exclude
 * them with no client-side filtering. This is the in-app analogue of the
 * push-side gate in selectPushTargets (which shares isDndActiveNow + the same
 * mute/DND semantics). Returns false on a missing pool or any query error so a
 * lookup failure never silently swallows a legitimate notification.
 */
export async function shouldDropForUser(
  pool: Pool,
  userId: string,
  channelId: string,
  now: number = Date.now(),
): Promise<boolean> {
  if (!userId || !channelId) return false
  try {
    // 1. Channel muted for this user.
    const { rows: muted } = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM aaelink.channel_notification_prefs
         WHERE channel_id = $1 AND user_id = $2 AND muted = true`,
      [channelId, userId],
    )
    if (muted.length > 0) return true

    // 2. DND schedule / snooze (same evaluation as selectPushTargets).
    const { rows: dnd } = await pool.query<{
      enabled: boolean
      start_time: string
      end_time: string
      timezone: string
      snooze_until: string
    }>(
      `SELECT enabled, start_time, end_time, timezone, snooze_until
         FROM aaelink.dnd_settings WHERE user_id = $1`,
      [userId],
    )
    const d = dnd[0]
    if (d) {
      if (Number(d.snooze_until) > now) return true
      if (d.enabled && isDndActiveNow(d.start_time, d.end_time, d.timezone, new Date(now))) {
        return true
      }
    }

    // 3. Manual status = 'dnd' (expires_at = 0 ⇒ never expires; positive ⇒ cutoff).
    const { rows: statusDnd } = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM aaelink.user_status
         WHERE user_id = $1 AND status = 'dnd'
           AND (expires_at = 0 OR expires_at > $2)`,
      [userId, now],
    )
    if (statusDnd.length > 0) return true

    return false
  } catch {
    return false
  }
}

/**
 * Filter `userIds` down to those NOT suppressed by mute/DND for `channelId`
 * (see shouldDropForUser). Used by every channel notify path so suppressed
 * in-app rows are never inserted. Order is not significant.
 */
async function dropSuppressedForChannel(
  pool: Pool,
  userIds: string[],
  channelId: string,
): Promise<string[]> {
  if (userIds.length === 0) return []
  const now = Date.now()
  const kept: string[] = []
  for (const u of userIds) {
    if (!(await shouldDropForUser(pool, u, channelId, now))) kept.push(u)
  }
  return kept
}

export async function notifyChannelMentions(args: {
  pool: Pool
  workspaceId: string
  channelId: string
  channelLabel: string
  messageId: string
  authorId: string
  authorLabel: string
  body: string
}): Promise<string[]> {
  const names = parseMentionUsernames(args.body)
  if (names.length === 0) return []
  let targets = await resolveMentionTargets(args.pool, args.workspaceId, names, args.authorId)
  if (targets.length === 0) return []
  targets = await filterUsersForNotification(args.pool, targets, 'mentions')
  if (targets.length === 0) return []
  const allowed: string[] = []
  for (const t of targets) {
    if (await userCanReadChannel(args.pool, t, args.channelId)) allowed.push(t)
  }
  targets = allowed
  // A muted channel (muted flag, channel_mutes row, or level='nothing') must
  // suppress the in-app mention row too, not just push — Slack parity. dropMuted
  // is a superset of dropLevelNothing so it covers the notifications-off case.
  targets = await dropMuted(args.pool, targets, args.channelId)
  if (targets.length === 0) return []
  // Suppress in-app rows for muted-channel / active-DND users at insert time
  // (so unread badges naturally exclude them — no client filtering).
  targets = await dropSuppressedForChannel(args.pool, targets, args.channelId)
  if (targets.length === 0) return []
  const title = `Mention in ${args.channelLabel}`
  const body = `${args.authorLabel}: ${snippet(args.body)}`
  await insertNotifications(
    args.pool,
    targets.map(user_id => ({
      user_id,
      kind: 'mention',
      title,
      body,
      workspace_id: args.workspaceId,
      channel_id: args.channelId,
      message_id: args.messageId,
      ticket_id: null
    }))
  )

  // Auto-push to mentioned users, respecting channel mute + DND.
  const pushable = await selectPushTargets(args.pool, targets, args.channelId)
  if (pushable.length > 0) {
    await enqueuePush(
      args.pool,
      { userIds: pushable, title, body, channelId: args.channelId, priority: 'high' },
      args.authorId
    )
  }
  return targets
}

/**
 * Notify channel members whose configured highlight keywords appear in a
 * message (Slack-style keyword highlights). One row per member is read from
 * notification_keywords; matching is done in-memory via matchKeywords. Members
 * already notified by an @mention (excludeUserIds) are skipped to avoid a
 * duplicate alert. Like mentions, keyword hits push (respecting mute + DND).
 */
export async function notifyKeywordMatches(args: {
  pool: Pool
  workspaceId: string
  channelId: string
  channelLabel: string
  messageId: string
  authorId: string
  authorLabel: string
  body: string
  excludeUserIds?: string[]
}): Promise<string[]> {
  const exclude = new Set([args.authorId, ...(args.excludeUserIds || [])])

  // Members of the channel (excluding author + already-notified) who have keywords.
  const { rows } = await args.pool.query<{ user_id: string; keyword: string }>(
    `SELECT nk.user_id, nk.keyword
       FROM aaelink.notification_keywords nk
       INNER JOIN aaelink.channel_members cm
         ON cm.user_id = nk.user_id AND cm.channel_id = $1`,
    [args.channelId]
  )
  if (rows.length === 0) return []

  const byUser = new Map<string, string[]>()
  for (const r of rows) {
    if (exclude.has(r.user_id)) continue
    const list = byUser.get(r.user_id) ?? []
    list.push(r.keyword)
    byUser.set(r.user_id, list)
  }
  if (byUser.size === 0) return []

  let hits = [...byUser.entries()]
    .filter(([, keywords]) => matchKeywords(args.body, keywords).length > 0)
    .map(([userId]) => userId)
  if (hits.length === 0) return []

  // Keyword highlights ride the 'mentions' notification preference.
  hits = await filterUsersForNotification(args.pool, hits, 'mentions')
  if (hits.length === 0) return []
  // Respect a per-channel level of 'nothing' (notifications off).
  hits = await dropLevelNothing(args.pool, hits, args.channelId)
  if (hits.length === 0) return []
  // Suppress for muted-channel / active-DND users at insert time.
  hits = await dropSuppressedForChannel(args.pool, hits, args.channelId)
  if (hits.length === 0) return []

  const title = `Keyword in ${args.channelLabel}`
  const body = `${args.authorLabel}: ${snippet(args.body)}`
  await insertNotifications(
    args.pool,
    hits.map(user_id => ({
      user_id,
      kind: 'keyword',
      title,
      body,
      workspace_id: args.workspaceId,
      channel_id: args.channelId,
      message_id: args.messageId,
      ticket_id: null
    }))
  )

  const pushable = await selectPushTargets(args.pool, hits, args.channelId)
  if (pushable.length > 0) {
    await enqueuePush(
      args.pool,
      { userIds: pushable, title, body, channelId: args.channelId, priority: 'high' },
      args.authorId
    )
  }
  return hits
}

/**
 * Notify channel members who set notification level 'all' — they want an alert
 * for every message, not just @mentions/keywords. Author and already-notified
 * (mentioned/keyword) users are excluded to avoid duplicate alerts. Push is
 * gated by selectPushTargets (which also drops 'nothing'/muted/DND).
 */
export async function notifyChannelLevelAll(args: {
  pool: Pool
  workspaceId: string
  channelId: string
  channelLabel: string
  messageId: string
  authorId: string
  authorLabel: string
  body: string
  excludeUserIds?: string[]
}): Promise<void> {
  const members = await channelMembersLevelAll(args.pool, args.channelId)
  if (members.length === 0) return
  const exclude = new Set([args.authorId, ...(args.excludeUserIds || [])])
  // Channel mute wins over level='all' for the in-app every-message alert too,
  // not just push.
  let targets = await dropMuted(args.pool, members.filter(u => !exclude.has(u)), args.channelId)
  if (targets.length === 0) return
  // Suppress for muted-channel / active-DND users at insert time.
  targets = await dropSuppressedForChannel(args.pool, targets, args.channelId)
  if (targets.length === 0) return

  const title = `New message in ${args.channelLabel}`
  const body = `${args.authorLabel}: ${snippet(args.body)}`
  await insertNotifications(
    args.pool,
    targets.map(user_id => ({
      user_id,
      kind: 'channel_message',
      title,
      body,
      workspace_id: args.workspaceId,
      channel_id: args.channelId,
      message_id: args.messageId,
      ticket_id: null
    }))
  )

  const pushable = await selectPushTargets(args.pool, targets, args.channelId)
  if (pushable.length > 0) {
    await enqueuePush(
      args.pool,
      { userIds: pushable, title, body, channelId: args.channelId, priority: 'normal' },
      args.authorId
    )
  }
}

/**
 * Notify the recipients of a direct / group-DM message: writes an in-app `dm`
 * notification for every channel member except the author, and enqueues a push
 * for those who haven't muted the DM and aren't in DND. A DM is direct, so the
 * in-app notification is not gated by the mention preference.
 */
export async function notifyDirectMessage(args: {
  pool: Pool
  workspaceId: string
  channelId: string
  messageId: string
  authorId: string
  authorLabel: string
  body: string
}): Promise<void> {
  const { rows } = await args.pool.query<{ user_id: string }>(
    `SELECT user_id FROM aaelink.channel_members WHERE channel_id = $1 AND user_id <> $2`,
    [args.channelId, args.authorId]
  )
  const recipients = rows.map(r => r.user_id)
  if (recipients.length === 0) return

  const body = snippet(args.body)
  await insertNotifications(
    args.pool,
    recipients.map(user_id => ({
      user_id,
      kind: 'dm',
      title: args.authorLabel,
      body,
      workspace_id: args.workspaceId,
      channel_id: args.channelId,
      message_id: args.messageId,
      ticket_id: null
    }))
  )

  const pushable = await selectPushTargets(args.pool, recipients, args.channelId)
  if (pushable.length > 0) {
    await enqueuePush(
      args.pool,
      {
        userIds: pushable,
        title: `New message from ${args.authorLabel}`,
        body,
        channelId: args.channelId,
        priority: 'high'
      },
      args.authorId
    )
  }
}

export async function notifyTicketReply(args: {
  pool: Pool
  workspaceId: string
  ticketId: string
  ticketTitle: string
  authorId: string
  authorLabel: string
  body: string
  createdBy: string | null
}): Promise<void> {
  const rows: NotificationInsertRow[] = []
  const snip = snippet(args.body)
  const seen = new Set<string>()

  if (args.createdBy && args.createdBy !== args.authorId) {
    rows.push({
      user_id: args.createdBy,
      kind: 'ticket_reply',
      title: `Reply on ticket: ${snippet(args.ticketTitle, 80)}`,
      body: `${args.authorLabel}: ${snip}`,
      workspace_id: args.workspaceId,
      channel_id: null,
      message_id: null,
      ticket_id: args.ticketId
    })
    seen.add(args.createdBy)
  }

  const names = parseMentionUsernames(args.body)
  const mentionIds = await resolveMentionTargets(args.pool, args.workspaceId, names, args.authorId)
  for (const user_id of mentionIds) {
    if (seen.has(user_id)) continue
    seen.add(user_id)
    rows.push({
      user_id,
      kind: 'ticket_mention',
      title: `Mention on ticket: ${snippet(args.ticketTitle, 80)}`,
      body: `${args.authorLabel}: ${snip}`,
      workspace_id: args.workspaceId,
      channel_id: null,
      message_id: null,
      ticket_id: args.ticketId
    })
  }

  const replyTargets = rows.filter(r => r.kind === 'ticket_reply').map(r => r.user_id)
  const mentionTargets = rows.filter(r => r.kind === 'ticket_mention').map(r => r.user_id)
  const allowReply = new Set(await filterUsersForNotification(args.pool, replyTargets, 'ticket_activity'))
  const allowMention = new Set(await filterUsersForNotification(args.pool, mentionTargets, 'mentions'))
  const filtered = rows.filter(
    r =>
      (r.kind === 'ticket_reply' && allowReply.has(r.user_id)) ||
      (r.kind === 'ticket_mention' && allowMention.has(r.user_id))
  )

  await insertNotifications(args.pool, filtered)
}

/** Notify IT staff (and super-admin) when someone submits an urgent message after OTP verification. */
export async function notifySupportEmergencyStaff(args: {
  pool: Pool
  reporterUserId: string
  reporterUsername: string
  emergencyId: string
  body: string
}): Promise<void> {
  const { rows } = await args.pool.query<{ id: string }>(
    `SELECT id FROM aaelink.users
     WHERE platform_role IN ('super_admin', 'it_admin', 'it_employee')`,
    []
  )
  let targets = rows.map(r => r.id).filter(id => id !== args.reporterUserId)
  targets = await filterUsersForNotification(args.pool, targets, 'system')
  if (targets.length === 0) return
  const title = 'Urgent IT message'
  const body = `@${args.reporterUsername}: ${snippet(args.body)}`
  await insertNotifications(
    args.pool,
    targets.map(user_id => ({
      user_id,
      kind: 'support_emergency',
      title,
      body,
      workspace_id: AAELINK_GLOBAL_WORKSPACE_ID,
      channel_id: null,
      message_id: args.emergencyId,
      ticket_id: null
    }))
  )
}

/** Notify a user when they are assigned to a ticket. */
export async function notifyTicketAssignment(args: {
  pool: Pool
  workspaceId: string
  ticketId: string
  ticketTitle: string
  assigneeId: string
  assignedByLabel: string
}): Promise<void> {
  const allowed = await filterUsersForNotification(args.pool, [args.assigneeId], 'ticket_activity')
  if (allowed.length === 0) return

  await insertNotifications(args.pool, [{
    user_id: args.assigneeId,
    kind: 'ticket_assignment',
    title: `Ticket assigned to you`,
    body: `${args.assignedByLabel} assigned you: ${snippet(args.ticketTitle, 100)}`,
    workspace_id: args.workspaceId,
    channel_id: null,
    message_id: null,
    ticket_id: args.ticketId
  }])
}

/** Notify the assignee and IT staff when an SLA is breached. */
export async function notifyTicketSlaBreach(args: {
  pool: Pool
  workspaceId: string
  ticketId: string
  ticketTitle: string
  priority: string
  assigneeId: string | null
}): Promise<void> {
  const { rows: itStaff } = await args.pool.query<{ id: string }>(
    `SELECT id FROM aaelink.users
     WHERE platform_role IN ('super_admin', 'it_admin', 'it_employee')`,
    []
  )
  const targetIds = new Set(itStaff.map(r => r.id))
  if (args.assigneeId) targetIds.add(args.assigneeId)

  let targets = [...targetIds]
  targets = await filterUsersForNotification(args.pool, targets, 'ticket_activity')
  if (targets.length === 0) return

  const title = `SLA breached — ${args.priority.toUpperCase()}`
  const body = `Ticket "${snippet(args.ticketTitle, 80)}" has exceeded its SLA deadline.`

  await insertNotifications(
    args.pool,
    targets.map(user_id => ({
      user_id,
      kind: 'ticket_sla_breach',
      title,
      body,
      workspace_id: args.workspaceId,
      channel_id: null,
      message_id: null,
      ticket_id: args.ticketId
    }))
  )
}

/**
 * Fan-out broadcast mention notifications (@here / @channel / @everyone).
 *
 * Rules (per task spec):
 *  - Skip entirely if channels.allow_broadcast_mentions = false.
 *  - @channel / @everyone → all channel members except sender.
 *  - @here → channel members whose user_status.status = 'online'
 *    (absent row defaults to 'online', matching the table DEFAULT).
 *  - Filter out users with user_notification_prefs.broadcast_mentions_enabled = false.
 *  - Dedup against directMentionUserIds (direct @mention wins; no second row).
 *  - Notification kind = 'broadcast'.
 *  - Push gated by selectPushTargets (mute + DND) same as mention path.
 *
 * Returns the list of user ids that received a broadcast notification.
 */
export async function notifyBroadcastMentions(args: {
  pool: Pool
  workspaceId: string
  channelId: string
  channelLabel: string
  messageId: string
  senderId: string
  senderLabel: string
  body: string
  tokens: Set<BroadcastToken>
  directMentionUserIds?: string[]
}): Promise<string[]> {
  if (args.tokens.size === 0) return []

  // 1. Check channel-level gate.
  const { rows: chRows } = await args.pool.query<{ allow_broadcast_mentions: boolean }>(
    `SELECT allow_broadcast_mentions FROM aaelink.channels WHERE id = $1`,
    [args.channelId]
  )
  if (chRows[0]?.allow_broadcast_mentions === false) return []

  // 2. Determine audience: @here uses online-only; @channel/@everyone uses all members.
  const needAll = args.tokens.has('channel') || args.tokens.has('everyone')

  let candidates: string[]
  if (needAll) {
    // All channel members except sender.
    const { rows } = await args.pool.query<{ user_id: string }>(
      `SELECT user_id FROM aaelink.channel_members WHERE channel_id = $1 AND user_id <> $2`,
      [args.channelId, args.senderId]
    )
    candidates = rows.map(r => r.user_id)
  } else {
    // @here only — members currently online (status = 'online' or no row → default 'online').
    const { rows } = await args.pool.query<{ user_id: string }>(
      `SELECT cm.user_id
         FROM aaelink.channel_members cm
         LEFT JOIN aaelink.user_status us ON us.user_id = cm.user_id
        WHERE cm.channel_id = $1
          AND cm.user_id <> $2
          AND COALESCE(us.status, 'online') = 'online'`,
      [args.channelId, args.senderId]
    )
    candidates = rows.map(r => r.user_id)
  }

  if (candidates.length === 0) return []

  // 3. Filter out users who have broadcast_mentions_enabled = false.
  const { rows: prefRows } = await args.pool.query<{ user_id: string }>(
    `SELECT t.user_id::text AS user_id
       FROM unnest($1::text[]) AS t(user_id)
       LEFT JOIN aaelink.user_notification_prefs p ON p.user_id = t.user_id
      WHERE COALESCE(p.broadcast_mentions_enabled, true) = true`,
    [candidates]
  )
  let targets = prefRows.map(r => r.user_id)
  if (targets.length === 0) return []

  // 4. Dedup against direct-mention recipients (direct mention wins).
  const directSet = new Set(args.directMentionUserIds ?? [])
  targets = targets.filter(u => !directSet.has(u))
  if (targets.length === 0) return []

  // 5. Respect channel-level 'nothing' (notifications off for this channel).
  targets = await dropLevelNothing(args.pool, targets, args.channelId)
  if (targets.length === 0) return []

  // 6. Suppress for muted-channel / active-DND users at insert time.
  targets = await dropSuppressedForChannel(args.pool, targets, args.channelId)
  if (targets.length === 0) return []

  const title = `Broadcast mention in ${args.channelLabel}`
  const body = `${args.senderLabel}: ${snippet(args.body)}`

  await insertNotifications(
    args.pool,
    targets.map(user_id => ({
      user_id,
      kind: 'broadcast',
      title,
      body,
      workspace_id: args.workspaceId,
      channel_id: args.channelId,
      message_id: args.messageId,
      ticket_id: null
    }))
  )

  // 6. Push, gated by selectPushTargets (mute + DND).
  const pushable = await selectPushTargets(args.pool, targets, args.channelId)
  if (pushable.length > 0) {
    await enqueuePush(
      args.pool,
      { userIds: pushable, title, body, channelId: args.channelId, priority: 'high' },
      args.senderId
    )
  }

  return targets
}

/**
 * Notify followers of a thread when a new reply is posted.
 *
 * Rules:
 *  - Fetch all users from thread_followers for the given thread_id.
 *  - Exclude the replier (they just posted — no self-notify).
 *  - Exclude users already notified via direct @mention (directMentionUserIds).
 *  - Drop followers who can no longer READ the channel (lost access → no leak).
 *  - Filter by thread_replies_enabled pref (default true).
 *  - Respect per-channel level='nothing' (in-app off).
 *  - Push gated by selectPushTargets (mute + DND) — same as mention path.
 *  - Notification kind = 'thread_reply'.
 *
 * Returns the list of user ids that received a thread_reply notification.
 */
export async function notifyThreadFollowers(args: {
  pool: Pool
  workspaceId: string
  channelId: string
  channelLabel: string
  threadId: string
  replyId: string
  replierId: string
  replierLabel: string
  body: string
  directMentionUserIds?: string[]
}): Promise<string[]> {
  // 1. Fetch thread followers, excluding the replier.
  const { rows: followerRows } = await args.pool.query<{ user_id: string }>(
    `SELECT user_id FROM aaelink.thread_followers
     WHERE thread_id = $1 AND user_id <> $2`,
    [args.threadId, args.replierId]
  )
  if (followerRows.length === 0) return []

  // 2. Dedup against direct-mention recipients (direct mention wins).
  const directSet = new Set(args.directMentionUserIds ?? [])
  let targets = followerRows.map(r => r.user_id).filter(u => !directSet.has(u))
  if (targets.length === 0) return []

  // 3. Drop followers who can no longer READ the channel — a user who lost
  //    channel access must not keep receiving reply notifications (info leak).
  //    Batched single query (no N+1) even for large follower lists.
  targets = await filterUsersCanReadChannel(args.pool, targets, args.channelId)
  if (targets.length === 0) return []

  // 4. Filter by thread_replies_enabled pref.
  targets = await filterUsersForNotification(args.pool, targets, 'thread_replies')
  if (targets.length === 0) return []

  // 5. Respect per-channel level='nothing'.
  targets = await dropLevelNothing(args.pool, targets, args.channelId)
  if (targets.length === 0) return []

  // 6. Suppress for muted-channel / active-DND users at insert time.
  targets = await dropSuppressedForChannel(args.pool, targets, args.channelId)
  if (targets.length === 0) return []

  const title = `New reply in ${args.channelLabel}`
  const body = `${args.replierLabel}: ${snippet(args.body)}`

  await insertNotifications(
    args.pool,
    targets.map(user_id => ({
      user_id,
      kind: 'thread_reply',
      title,
      body,
      workspace_id: args.workspaceId,
      channel_id: args.channelId,
      message_id: args.replyId,
      ticket_id: null
    }))
  )

  // 6. Push, gated by selectPushTargets (mute + DND).
  const pushable = await selectPushTargets(args.pool, targets, args.channelId)
  if (pushable.length > 0) {
    await enqueuePush(
      args.pool,
      { userIds: pushable, title, body, channelId: args.channelId, priority: 'high' },
      args.replierId
    )
  }

  return targets
}

/** Notify the original ticket requester when their ticket status changes. */
export async function notifyTicketStatusChange(args: {
  pool: Pool
  workspaceId: string
  ticketId: string
  ticketTitle: string
  createdBy: string
  changedById: string
  changedByLabel: string
  oldStatus: string
  newStatus: string
}): Promise<void> {
  // Don't notify if the requester is the one making the change
  if (args.createdBy === args.changedById) return

  const allowed = await filterUsersForNotification(args.pool, [args.createdBy], 'ticket_activity')
  if (allowed.length === 0) return

  const statusLabels: Record<string, string> = {
    open: 'Open', pending: 'Pending', in_progress: 'In Progress',
    resolved: 'Resolved', closed: 'Closed'
  }
  const from = statusLabels[args.oldStatus] || args.oldStatus
  const to = statusLabels[args.newStatus] || args.newStatus

  await insertNotifications(args.pool, [{
    user_id: args.createdBy,
    kind: 'ticket_status',
    title: `Ticket updated: ${from} → ${to}`,
    body: `${args.changedByLabel} updated "${snippet(args.ticketTitle, 80)}" from ${from} to ${to}.`,
    workspace_id: args.workspaceId,
    channel_id: null,
    message_id: null,
    ticket_id: args.ticketId
  }])
}
