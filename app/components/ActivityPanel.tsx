'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  AtSign,
  Heart,
  MessageSquare,
  Bell,
  Filter,
  ArrowLeft,
  RefreshCw,
  Hash,
  Lock,
  User
} from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'

interface ActivityItem {
  source_id: string
  activity_type: 'mention' | 'reaction' | 'thread_reply'
  body: string
  actor_id: string
  actor_username: string
  actor_first_name: string
  actor_last_name: string
  actor_avatar_url: string
  channel_id: string
  channel_name: string
  channel_type: string
  root_id: string
  activity_at: number
}

interface Props {
  workspaceId: string
  onClose: () => void
  onNavigateToChannel?: (channelId: string, messageId?: string) => void
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return 'Just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

function actorName(item: ActivityItem): string {
  const full = `${item.actor_first_name} ${item.actor_last_name}`.trim()
  return full || item.actor_username
}

type FilterMode = 'all' | 'mentions' | 'reactions' | 'threads'

export function ActivityPanel({ workspaceId, onClose, onNavigateToChannel }: Props) {
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterMode>('all')
  const [hasMore, setHasMore] = useState(false)

  const load = useCallback(async (filterMode: FilterMode) => {
    setLoading(true)
    try {
      const res = await apiFetch(`/api/activity?workspace_id=${encodeURIComponent(workspaceId)}&filter=${filterMode}&limit=50`)
      const data = await res.json()
      setActivities(data.activities || [])
      setHasMore(data.has_more || false)
    } catch {
      setActivities([])
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => { load(filter) }, [load, filter])

  const loadMore = useCallback(async () => {
    if (activities.length === 0) return
    const oldest = activities[activities.length - 1].activity_at
    try {
      const res = await apiFetch(`/api/activity?workspace_id=${encodeURIComponent(workspaceId)}&filter=${filter}&limit=50&before=${oldest}`)
      const data = await res.json()
      setActivities(prev => [...prev, ...(data.activities || [])])
      setHasMore(data.has_more || false)
    } catch { /* ignore */ }
  }, [activities, workspaceId, filter])

  const getIcon = (type: string) => {
    switch (type) {
      case 'mention': return <AtSign size={16} className="activity-icon activity-icon--mention" />
      case 'reaction': return <Heart size={16} className="activity-icon activity-icon--reaction" />
      case 'thread_reply': return <MessageSquare size={16} className="activity-icon activity-icon--thread" />
      default: return <Bell size={16} className="activity-icon" />
    }
  }

  const getLabel = (item: ActivityItem) => {
    const name = actorName(item)
    switch (item.activity_type) {
      case 'mention': return <><strong>{name}</strong> mentioned you</>
      case 'reaction': return <><strong>{name}</strong> reacted {item.body} to your message</>
      case 'thread_reply': return <><strong>{name}</strong> replied in a thread you started</>
      default: return <><strong>{name}</strong> interacted with you</>
    }
  }

  const channelIcon = (type: string) => {
    if (type === 'P') return <Lock size={12} />
    if (type === 'D') return <User size={12} />
    return <Hash size={12} />
  }

  const filters: { key: FilterMode; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'mentions', label: 'Mentions' },
    { key: 'reactions', label: 'Reactions' },
    { key: 'threads', label: 'Threads' }
  ]

  return (
    <div className="activity-panel">
      {/* Header */}
      <header className="activity-panel__header">
        <button type="button" className="activity-panel__back" onClick={onClose} aria-label="Close">
          <ArrowLeft size={18} />
        </button>
        <h2 className="activity-panel__title">
          <Bell size={18} /> Activity
        </h2>
        <button type="button" className="activity-panel__refresh" onClick={() => load(filter)} aria-label="Refresh">
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
        </button>
      </header>

      {/* Filter tabs */}
      <div className="activity-panel__filters">
        {filters.map(f => (
          <button
            key={f.key}
            type="button"
            className={`activity-panel__filter-tab${filter === f.key ? ' activity-panel__filter-tab--active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.key === 'mentions' && <AtSign size={13} />}
            {f.key === 'reactions' && <Heart size={13} />}
            {f.key === 'threads' && <MessageSquare size={13} />}
            {f.key === 'all' && <Filter size={13} />}
            {f.label}
          </button>
        ))}
      </div>

      {/* Activity list */}
      <div className="activity-panel__list">
        {loading && activities.length === 0 ? (
          <div className="activity-panel__empty">
            <RefreshCw size={24} className="spin" style={{ opacity: 0.4 }} />
            <p>Loading activity…</p>
          </div>
        ) : activities.length === 0 ? (
          <div className="activity-panel__empty">
            <Bell size={32} style={{ opacity: 0.25 }} />
            <p style={{ marginTop: 8, fontSize: 14, color: 'var(--mm-text-muted)' }}>
              {filter === 'all' ? 'No activity yet' : `No ${filter} activity`}
            </p>
          </div>
        ) : (
          <>
            {activities.map(item => (
              <button
                key={`${item.source_id}-${item.activity_type}`}
                type="button"
                className="activity-panel__item"
                onClick={() => onNavigateToChannel?.(item.channel_id, item.source_id)}
              >
                <div className="activity-panel__item-avatar">
                  {item.actor_avatar_url ? (
                    <img src={item.actor_avatar_url} alt="" className="activity-panel__avatar-img" />
                  ) : (
                    <div className="activity-panel__avatar-fallback">
                      {(item.actor_first_name || item.actor_username || '?')[0].toUpperCase()}
                    </div>
                  )}
                  <span className="activity-panel__item-type-badge">{getIcon(item.activity_type)}</span>
                </div>
                <div className="activity-panel__item-body">
                  <div className="activity-panel__item-label">
                    {getLabel(item)}
                  </div>
                  {item.activity_type !== 'reaction' && item.body && (
                    <div className="activity-panel__item-preview">
                      {item.body.slice(0, 120)}
                      {item.body.length > 120 ? '…' : ''}
                    </div>
                  )}
                  <div className="activity-panel__item-meta">
                    <span className="activity-panel__item-channel">
                      {channelIcon(item.channel_type)} {item.channel_name}
                    </span>
                    <span className="activity-panel__item-time">{timeAgo(item.activity_at)}</span>
                  </div>
                </div>
              </button>
            ))}
            {hasMore && (
              <button type="button" className="activity-panel__load-more" onClick={loadMore}>
                Load more…
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
