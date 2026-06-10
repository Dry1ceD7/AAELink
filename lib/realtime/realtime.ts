'use client'

import type { ReactionSummary } from '@/lib/messaging/reactions'
import { apiFetch } from '@/lib/api/apiClient'
import { subscribeNetworkOrVisibilityResume } from '@/lib/realtime/sseResilience'

export interface FileAttachment {
  id: string
  name: string
  size: number
  mime_type: string
  url: string
}

export interface ChatPost {
  id: string
  channel_id: string
  user_id: string
  message: string
  create_at: number
  root_id?: string
  /** Number of thread replies (root posts only; from server or client bump). */
  reply_count?: number
  /** Aggregated quick reactions for this message. */
  reactions?: ReactionSummary[]
  /** Server ms when body was last edited (only if after create_at). */
  edited_at?: number
  pending?: boolean
  /** File attachments uploaded with this message. */
  file_attachments?: FileAttachment[]
  /** Most recent readers of this message (excludes the author; capped server-side). */
  read_receipts?: ReadReceipt[]
  /** System message type ('' = normal, 'system_join', 'system_leave', 'system_topic', 'system_purpose', 'system_pin', 'system_header', 'system_channel_converted', 'system_archive'). */
  type?: string
}

/** One HTTP poll for channel deltas (same contract as {@link startMessagePoll} intervals). */
export async function runMessagePollOnce(
  channelId: string,
  getSinceMs: () => number,
  onIncoming: (posts: ChatPost[]) => void,
  threadRootId?: string,
  onDeletions?: (deletions: CollabDeletion[]) => void,
  onThreadReplyCount?: (n: number) => void,
  onReplyCountsFromPoll?: (counts: Record<string, number>) => void
): Promise<void> {
  const since = getSinceMs()
  const q = new URLSearchParams({
    channel_id: channelId,
    since: String(since)
  })
  if (threadRootId) q.set('root_id', threadRootId)
  const res = await apiFetch(`/api/messages?${q}`)
  if (!res.ok) return
  const data = (await res.json()) as {
    posts?: ChatPost[]
    deletions?: CollabDeletion[]
    thread_reply_count?: number
    reply_counts?: Record<string, number>
  }
  const list = data.posts ?? []
  if (list.length) onIncoming(list)
  const rc = data.reply_counts
  if (rc && Object.keys(rc).length > 0 && onReplyCountsFromPoll) {
    onReplyCountsFromPoll(rc)
  }
  const dels = data.deletions ?? []
  if (dels.length && onDeletions) onDeletions(dels)
  if (
    threadRootId &&
    onThreadReplyCount &&
    data.thread_reply_count !== undefined &&
    Number.isFinite(data.thread_reply_count)
  ) {
    onThreadReplyCount(data.thread_reply_count)
  }
}

/** Polls for new messages when streaming is unavailable (optional thread root). */
export function startMessagePoll(
  channelId: string,
  getSinceMs: () => number,
  onIncoming: (posts: ChatPost[]) => void,
  threadRootId?: string,
  onDeletions?: (deletions: CollabDeletion[]) => void,
  onThreadReplyCount?: (n: number) => void,
  onReplyCountsFromPoll?: (counts: Record<string, number>) => void
): () => void {
  const tick = () => void runMessagePollOnce(
    channelId,
    getSinceMs,
    onIncoming,
    threadRootId,
    onDeletions,
    onThreadReplyCount,
    onReplyCountsFromPoll
  )
  const t0 = setTimeout(() => void tick(), 600)
  const id = setInterval(() => void tick(), 2500)
  /** Thread-only polls (no `connectCollab`) still catch up after sleep. When used under `connectCollab`, that resume runs first and clears this before this fires. */
  const removePollResume = subscribeNetworkOrVisibilityResume(() => void tick())
  return () => {
    removePollResume()
    clearTimeout(t0)
    clearInterval(id)
  }
}

const SSE_RETRY_MAX = 5
const SSE_RETRY_BASE_MS = 700

export type CollabDeletion = {
  id: string
  deleted_at: number
  /** Present when the server includes it; used to refresh thread reply totals. */
  thread_root_id?: string
}

export type CollabSsePayload = {
  posts?: ChatPost[]
  /** Latest total reply counts for roots that had new thread activity. */
  reply_counts?: Record<string, number>
  /** Tombstones for messages removed since the client cursor (main channel collab). */
  deletions?: CollabDeletion[]
  /** message_id → current reader stack, for messages whose reads advanced since the cursor. */
  read_receipts?: Record<string, ReadReceipt[]>
  /** Server's advanced read watermark; echoed back as `read_since` to resume on reconnect. */
  read_cursor?: number
}

/** One reader of a message: who read it and when (ms epoch). */
export type ReadReceipt = {
  user_id: string
  read_at: number
}

/**
 * Realtime read-receipt fan-out: a member ({@link ReadReceipt.user_id}) read a
 * message in a channel. Emitted by `POST /api/messages/:id/read` through
 * redisPubSub and delivered to channel subscribers so reader avatar stacks can
 * update live.
 */
export type MessageReadEvent = {
  type: 'message_read'
  channel_id: string
  message_id: string
  user_id: string
  read_at: number
}

/**
 * Live updates for the active channel: Server-Sent Events when supported,
 * with a few timed reconnects, then HTTP polling if the stream stays down.
 *
 * @param onSseConnected Optional UI hook: `true` when the SSE socket is open, `false` when polling or between reconnect attempts.
 */
export function connectCollab(
  channelId: string,
  getSinceMs: () => number,
  onIncoming: (posts: ChatPost[]) => void,
  onReplyCounts?: (counts: Record<string, number>) => void,
  onDeletions?: (deletions: CollabDeletion[]) => void,
  onSseConnected?: (connected: boolean) => void,
  onReadReceipts?: (map: Record<string, ReadReceipt[]>) => void
): () => void {
  if (typeof window === 'undefined') return () => { }

  let disposed = false
  let pollStop: (() => void) | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let es: EventSource | null = null
  /** Consecutive failed connection attempts (reset after a delivered event or successful open). */
  let sseFailures = 0
  /** Last read watermark the server confirmed; resumes the receipt stream on reconnect. */
  let lastReadCursor: number | null = null
  let removeResume: (() => void) | null = null

  const clearReconnect = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  const stopPoll = () => {
    if (pollStop) {
      pollStop()
      pollStop = null
    }
  }

  const startPoll = () => {
    if (disposed || pollStop) return
    // HTTP polling is a supported live path; treat as connected so the UI does not
    // show a perpetual "Connecting" state after SSE retries are exhausted.
    onSseConnected?.(true)
    pollStop = startMessagePoll(
      channelId,
      getSinceMs,
      onIncoming,
      undefined,
      onDeletions,
      undefined,
      onReplyCounts
    )
  }

  const closeEs = () => {
    try {
      es?.close()
    } catch {
      /* ignore */
    }
    es = null
  }

  const attachEs = () => {
    if (disposed) return
    clearReconnect()
    stopPoll()
    if (typeof EventSource === 'undefined') {
      startPoll()
      return
    }
    try {
      const u = new URL('/api/collab/events', window.location.origin)
      u.searchParams.set('channel_id', channelId)
      u.searchParams.set('since', String(getSinceMs()))
      // Resume the read-receipt stream from the last confirmed cursor so reads
      // during a disconnect gap are re-delivered rather than skipped.
      if (lastReadCursor !== null) u.searchParams.set('read_since', String(lastReadCursor))
      const source = new EventSource(u.toString())
      es = source

      source.onopen = () => {
        sseFailures = 0
        onSseConnected?.(true)
      }

      source.onmessage = ev => {
        try {
          const data = JSON.parse(ev.data as string) as CollabSsePayload
          const hasPosts = Boolean(data.posts?.length)
          const rc = data.reply_counts
          const hasRc = Boolean(rc && Object.keys(rc).length > 0)
          const dels = data.deletions ?? []
          const hasDel = dels.length > 0
          const rr = data.read_receipts
          const hasRr = Boolean(rr && Object.keys(rr).length > 0)
          if (hasPosts || hasRc || hasDel || hasRr) sseFailures = 0
          if (hasPosts) onIncoming(data.posts!)
          if (hasRc && onReplyCounts) onReplyCounts(rc!)
          if (hasDel && onDeletions) onDeletions(dels)
          if (hasRr && onReadReceipts) onReadReceipts(rr!)
          if (typeof data.read_cursor === 'number' && Number.isFinite(data.read_cursor)) {
            lastReadCursor = data.read_cursor
          }
        } catch {
          /* ignore malformed */
        }
      }

      source.onerror = () => {
        if (disposed) return
        onSseConnected?.(false)
        closeEs()
        sseFailures += 1
        if (sseFailures <= SSE_RETRY_MAX) {
          const delay = SSE_RETRY_BASE_MS * sseFailures
          reconnectTimer = setTimeout(() => attachEs(), delay)
        } else {
          startPoll()
        }
      }
    } catch {
      startPoll()
    }
  }

  removeResume = subscribeNetworkOrVisibilityResume(() => {
    if (disposed) return
    if (pollStop) {
      void runMessagePollOnce(
        channelId,
        getSinceMs,
        onIncoming,
        undefined,
        onDeletions,
        undefined,
        onReplyCounts
      )
    }
    sseFailures = 0
    clearReconnect()
    closeEs()
    stopPoll()
    attachEs()
  })

  attachEs()

  return () => {
    disposed = true
    removeResume?.()
    removeResume = null
    clearReconnect()
    closeEs()
    stopPoll()
  }
}

/**
 * Legacy Mattermost WebSocket bridge used by the slim `app/home/page.tsx` shell.
 * Native collab uses {@link connectCollab} instead; these remain as no-ops so the app builds.
 */
export function connectMattermost(_onPost: (post: ChatPost) => void): Promise<void> {
  return Promise.resolve()
}

export function disconnectMattermost(_onPost: (post: ChatPost) => void): void {
  void _onPost
}
