'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MessageSquare, RefreshCw, User, CheckCheck } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'

interface ThreadRow {
  id: string
  channel_id: string
  author_id: string
  body: string
  created_at: number
  channel_name: string
  reply_count: number
  last_reply_at: number | null
  /** Whether the current user has replied in this thread */
  is_following?: boolean
  /** Number of replies the current user hasn't read yet (audit §6.2) */
  unread_count?: number
}

function snippet(html: string, max = 120): string {
  const text = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return text.slice(0, max) + '…'
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  if (diff < 172800_000) return 'yesterday'
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

type ThreadFilter = 'all' | 'following' | 'unread'

export function ThreadsListPanel({
  workspaceId,
  onOpenThread
}: {
  workspaceId: string
  onOpenThread: (channelId: string, rootId: string) => void
}) {
  const [threads, setThreads] = useState<ThreadRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<ThreadFilter>('following')
  const [marking, setMarking] = useState(false)

  const load = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch(`/api/threads?workspace_id=${encodeURIComponent(workspaceId)}`)
      if (!res.ok) {
        setError('Could not load threads.')
        return
      }
      const data = await res.json() as { threads: ThreadRow[] }
      setThreads(data.threads || [])
    } catch {
      setError('Could not load threads.')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => { void load() }, [load])

  // Refresh when the tab becomes visible again (match TicketsPanel behavior)
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && workspaceId) void load()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [load, workspaceId])

  const followingCount = useMemo(() => threads.filter(t => t.is_following).length, [threads])
  const unreadCount = useMemo(
    () => threads.filter(t => t.is_following && (t.unread_count ?? 0) > 0).length,
    [threads]
  )

  const filteredThreads = useMemo(() => {
    let list = threads
    if (filter === 'following') list = threads.filter(t => t.is_following)
    else if (filter === 'unread') list = threads.filter(t => t.is_following && (t.unread_count ?? 0) > 0)
    // Sort: unread first, then most recent
    return [...list].sort((a, b) => {
      const aUn = (a.unread_count ?? 0) > 0 ? 1 : 0
      const bUn = (b.unread_count ?? 0) > 0 ? 1 : 0
      if (aUn !== bUn) return bUn - aUn
      return (b.last_reply_at ?? b.created_at) - (a.last_reply_at ?? a.created_at)
    })
  }, [threads, filter])

  const markAllRead = useCallback(async () => {
    if (!workspaceId) return
    setMarking(true)
    try {
      const res = await apiFetch('/api/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId }),
      })
      if (res.ok) await load()
    } finally {
      setMarking(false)
    }
  }, [workspaceId, load])

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div className="thread-filter-bar">
          <button type="button" className="mm-notif-filter-tab mm-notif-filter-tab--active" disabled>Following</button>
          <button type="button" className="mm-notif-filter-tab" disabled>All Threads</button>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mm-muted)' }}>
          <p className="module-loading">Loading threads…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mm-muted)', flexDirection: 'column', gap: 12 }}>
        <p>{error}</p>
        <button type="button" className="ghost-button" onClick={() => void load()}>
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Filter tabs + Mark all read */}
      <div className="thread-filter-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className={`mm-notif-filter-tab${filter === 'following' ? ' mm-notif-filter-tab--active' : ''}`}
            onClick={() => setFilter('following')}
          >
            <User size={12} style={{ marginRight: 4, verticalAlign: '-1px' }} />
            Following{followingCount > 0 ? ` (${followingCount})` : ''}
          </button>
          <button
            type="button"
            className={`mm-notif-filter-tab${filter === 'unread' ? ' mm-notif-filter-tab--active' : ''}`}
            onClick={() => setFilter('unread')}
          >
            Unread{unreadCount > 0 ? ` (${unreadCount})` : ''}
          </button>
          <button
            type="button"
            className={`mm-notif-filter-tab${filter === 'all' ? ' mm-notif-filter-tab--active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All Threads{threads.length > 0 ? ` (${threads.length})` : ''}
          </button>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            className="ghost-button"
            disabled={marking}
            onClick={() => void markAllRead()}
            style={{ fontSize: 12, padding: '4px 10px' }}
            aria-label="Mark all threads as read"
          >
            <CheckCheck size={12} /> {marking ? 'Marking…' : 'Mark all read'}
          </button>
        )}
      </div>

      {/* Thread list */}
      {filteredThreads.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mm-muted)' }}>
          <div style={{ textAlign: 'center' }}>
            <MessageSquare size={48} style={{ opacity: 0.4, marginBottom: 16 }} />
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--fg)' }}>
              {filter === 'unread'
                ? 'No unread thread replies'
                : filter === 'following'
                  ? 'No threads you\'re following'
                  : 'No threads yet'}
            </h2>
            <p style={{ maxWidth: 320, margin: '0 auto' }}>
              {filter === 'following' || filter === 'unread'
                ? 'When you reply to a message, you\'ll automatically follow that thread.'
                : 'When you reply to a message in a channel, it will show up here.'
              }
            </p>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto', padding: '0' }}>
          {filteredThreads.map(t => {
            const unread = t.unread_count ?? 0
            return (
              <button
                key={t.id}
                type="button"
                className={`thread-list-row aae-hoverable${unread > 0 ? ' thread-list-row--unread' : ''}`}
                onClick={() => onOpenThread(t.channel_id, t.id)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '14px 20px',
                  border: 'none', background: 'transparent', cursor: 'pointer',
                  borderBottom: '1px solid var(--mm-border-subtle)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--mm-link)', fontWeight: 600 }}>#{t.channel_name}</span>
                  <span style={{ fontSize: 12, color: 'var(--mm-muted)' }}>
                    {t.last_reply_at ? timeAgo(t.last_reply_at) : timeAgo(t.created_at)}
                  </span>
                  {t.is_following && unread === 0 && (
                    <span style={{ fontSize: 10, color: 'var(--aae-accent, var(--aae-link))', fontWeight: 700, opacity: 0.7 }}>Following</span>
                  )}
                  {unread > 0 && (
                    <span
                      aria-label={`${unread} unread ${unread === 1 ? 'reply' : 'replies'}`}
                      style={{
                        marginLeft: 'auto', fontSize: 11, fontWeight: 700,
                        background: '#e01e5a', color: '#fff',
                        padding: '1px 7px', borderRadius: 10,
                      }}
                    >
                      {unread} new
                    </span>
                  )}
                </div>
                <p style={{ margin: 0, fontSize: 14, color: 'var(--fg)', lineHeight: 1.4, fontWeight: unread > 0 ? 600 : 400 }}>
                  {snippet(t.body)}
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                  <MessageSquare size={13} style={{ color: 'var(--mm-muted)' }} />
                  <span style={{ fontSize: 12, color: 'var(--mm-muted)' }}>
                    {t.reply_count} {t.reply_count === 1 ? 'reply' : 'replies'}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
