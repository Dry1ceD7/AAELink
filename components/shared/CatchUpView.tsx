'use client'

import { useState, useCallback, useEffect } from 'react'
import { apiFetch } from '@/lib/api/apiClient'
import { Zap, MessageSquare, AtSign, SmilePlus, GitBranch, UserPlus, Clock, Check, CheckCheck, X, Pin, ChevronRight, Loader2 } from 'lucide-react'

/* ─────────────────────────────────────────────────────────────────────
   CatchUpView — Slack "Catch Up" / "Later" triage interface
   Wired to /api/notifications for real data.
   ───────────────────────────────────────────────────────────────────── */

interface CatchUpItem {
  id: string
  type: 'mention' | 'dm' | 'reaction' | 'thread_reply' | 'channel_invite' | 'reminder' | 'general'
  channelName: string
  channelId: string
  senderName: string
  content: string
  timestamp: string
  isRead: boolean
  isDone: boolean
  isDeferred: boolean
  deferUntil?: string
  kind: string
}

function mapKindToType(kind: string): CatchUpItem['type'] {
  if (kind?.includes('mention')) return 'mention'
  if (kind?.includes('dm') || kind?.includes('direct')) return 'dm'
  if (kind?.includes('reaction')) return 'reaction'
  if (kind?.includes('thread') || kind?.includes('reply')) return 'thread_reply'
  if (kind?.includes('invite')) return 'channel_invite'
  if (kind?.includes('remind')) return 'reminder'
  return 'general'
}

function timeAgo(ts: number): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? 's' : ''} ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

const TYPE_ICON: Record<string, typeof Zap> = {
  mention: AtSign,
  dm: MessageSquare,
  reaction: SmilePlus,
  thread_reply: GitBranch,
  channel_invite: UserPlus,
  reminder: Clock,
  general: Zap,
}

const TYPE_COLOR: Record<string, string> = {
  mention: 'rgba(67,97,238,0.12)',
  dm: 'rgba(43,172,118,0.12)',
  reaction: 'rgba(232,168,32,0.12)',
  thread_reply: 'rgba(139,92,246,0.12)',
  channel_invite: 'rgba(6,182,212,0.12)',
  reminder: 'rgba(245,158,11,0.12)',
  general: 'rgba(97,96,97,0.08)',
}

const DEFER_OPTIONS = [
  { label: 'In 20 minutes', value: 20 },
  { label: 'In 1 hour', value: 60 },
  { label: 'In 3 hours', value: 180 },
  { label: 'Tomorrow morning', value: 0 },
  { label: 'Next week', value: 0 },
]

type FilterTab = 'all' | 'unreads' | 'mentions' | 'dms' | 'threads' | 'later'

export default function CatchUpView({ onClose, onNavigateToChannel }: {
  onClose: () => void
  onNavigateToChannel?: (channelId: string) => void
}) {
  const [items, setItems] = useState<CatchUpItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const [expandedItem, setExpandedItem] = useState<string | null>(null)
  const [showDeferMenu, setShowDeferMenu] = useState<string | null>(null)

  /* ── Load notifications from backend ─────────────── */
  const loadNotifications = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await apiFetch('/api/notifications')
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      const mapped: CatchUpItem[] = (data.notifications || []).map((n: Record<string, string | number | null>) => ({
        id: n.id as string,
        type: mapKindToType(n.kind as string),
        channelName: '',
        channelId: (n.channel_id as string) || '',
        senderName: '',
        content: `${n.title || ''}${n.body ? ' — ' + n.body : ''}`,
        timestamp: timeAgo(Number(n.created_at)),
        isRead: Number(n.read_at) > 0,
        isDone: Number(n.read_at) > 0,
        isDeferred: false,
        kind: n.kind as string,
      }))
      setItems(mapped)
    } catch {
      setError('Failed to load notifications')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadNotifications() }, [loadNotifications])

  /* ── Actions ─────────────────────────────────────── */
  const markDone = useCallback(async (id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, isDone: true, isRead: true } : i))
    await apiFetch('/api/notifications', {
      method: 'PATCH', body: JSON.stringify({ ids: [id] }),
    }).catch(() => {})
  }, [])

  const markAllDone = useCallback(async () => {
    setItems(prev => prev.map(i => ({ ...i, isDone: true, isRead: true })))
    await apiFetch('/api/notifications', {
      method: 'PATCH', body: JSON.stringify({ read_all: true }),
    }).catch(() => {})
  }, [])

  const deferItem = useCallback((id: string, label: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, isDeferred: true, deferUntil: label } : i))
    setShowDeferMenu(null)
  }, [])

  const undeferItem = useCallback((id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, isDeferred: false, deferUntil: undefined } : i))
  }, [])

  /* ── Derived ─────────────────────────────────────── */
  const filteredItems = items.filter(item => {
    switch (activeTab) {
      case 'unreads': return !item.isRead && !item.isDone
      case 'mentions': return item.type === 'mention'
      case 'dms': return item.type === 'dm'
      case 'threads': return item.type === 'thread_reply'
      case 'later': return item.isDeferred
      default: return !item.isDone
    }
  })

  const TABS: { key: FilterTab; label: string; count?: number }[] = [
    { key: 'all', label: 'All', count: items.filter(i => !i.isDone).length },
    { key: 'unreads', label: 'Unreads', count: items.filter(i => !i.isRead && !i.isDone).length },
    { key: 'mentions', label: '@Mentions', count: items.filter(i => i.type === 'mention' && !i.isDone).length },
    { key: 'dms', label: 'DMs', count: items.filter(i => i.type === 'dm' && !i.isDone).length },
    { key: 'threads', label: 'Threads', count: items.filter(i => i.type === 'thread_reply' && !i.isDone).length },
    { key: 'later', label: 'Later', count: items.filter(i => i.isDeferred).length },
  ]

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--mm-main-bg)', color: 'var(--mm-text)',
      animation: 'slack-slide-up 200ms var(--slack-ease-out) forwards',
    }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Zap size={20} style={{ color: 'var(--mm-link)' }} />
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Catch Up</h2>
            {items.filter(i => !i.isRead && !i.isDone).length > 0 && (
              <span style={{
                background: '#e01e5a', color: '#fff', borderRadius: 10,
                padding: '2px 8px', fontSize: 11, fontWeight: 700,
              }}>
                {items.filter(i => !i.isRead && !i.isDone).length} new
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={markAllDone} style={{
              background: 'none', border: '1px solid var(--mm-border)',
              borderRadius: 8, padding: '6px 14px', fontSize: 12,
              cursor: 'pointer', color: 'var(--mm-muted)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}><CheckCheck size={14} /> Mark all done</button>
            <button onClick={onClose} style={{
              background: 'none', border: 'none', fontSize: 20,
              cursor: 'pointer', color: 'var(--mm-muted)', padding: 4,
            }}><X size={18} /></button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
              padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13,
              fontWeight: activeTab === tab.key ? 700 : 400,
              background: activeTab === tab.key ? 'var(--mm-hover-bg)' : 'none',
              color: activeTab === tab.key ? 'var(--mm-link)' : 'var(--mm-muted)',
              transition: 'all 150ms ease', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
            }}>
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 8,
                  background: activeTab === tab.key ? 'var(--mm-link)' : 'var(--mm-border)',
                  color: activeTab === tab.key ? '#fff' : 'var(--mm-muted)', fontWeight: 600,
                }}>{tab.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Items List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, opacity: 0.5 }}>
            <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13, marginTop: 8 }}>Loading notifications…</span>
          </div>
        ) : error ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, opacity: 0.5 }}>
            <X size={32} />
            <span style={{ fontSize: 14, fontWeight: 600, marginTop: 8 }}>{error}</span>
            <button onClick={loadNotifications} style={{ marginTop: 8, background: 'var(--mm-link)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>Retry</button>
          </div>
        ) : filteredItems.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, opacity: 0.5 }}>
            {activeTab === 'later' ? <Pin size={36} /> : <Zap size={36} />}
            <span style={{ fontSize: 15, fontWeight: 600, marginTop: 8 }}>
              {activeTab === 'later' ? 'Nothing saved for later' : "You're all caught up!"}
            </span>
            <span style={{ fontSize: 13, marginTop: 4 }}>
              {activeTab === 'later' ? 'Deferred items will appear here.' : 'No new notifications to review.'}
            </span>
          </div>
        ) : (
          filteredItems.map(item => {
            const IconComp = TYPE_ICON[item.type] || Zap
            return (
              <div key={item.id} style={{
                padding: '14px 20px', borderBottom: '1px solid var(--mm-border-subtle)',
                display: 'flex', gap: 12, alignItems: 'flex-start',
                background: !item.isRead ? 'rgba(67,97,238,0.03)' : 'transparent',
                transition: 'background 150ms ease', cursor: 'pointer', position: 'relative',
              }}
              onMouseEnter={e => { if (item.isRead) e.currentTarget.style.background = 'var(--mm-hover-bg)' }}
              onMouseLeave={e => { e.currentTarget.style.background = !item.isRead ? 'rgba(67,97,238,0.03)' : 'transparent' }}
              onClick={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: TYPE_COLOR[item.type] || TYPE_COLOR.general,
                  display: 'grid', placeItems: 'center', flexShrink: 0,
                }}>
                  <IconComp size={16} style={{ color: 'var(--mm-text)', opacity: 0.7 }} />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 12, opacity: 0.5, textTransform: 'uppercase' }}>{item.kind || item.type}</span>
                    <span style={{ fontSize: 11, opacity: 0.4, marginLeft: 'auto' }}>{item.timestamp}</span>
                    {!item.isRead && (
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4361EE', flexShrink: 0 }} />
                    )}
                  </div>
                  <div style={{
                    fontSize: 14, lineHeight: 1.5, opacity: 0.85,
                    overflow: 'hidden', textOverflow: 'ellipsis',
                    display: expandedItem === item.id ? 'block' : '-webkit-box',
                    WebkitLineClamp: expandedItem === item.id ? undefined : 2,
                    WebkitBoxOrient: 'vertical' as const,
                  }}>
                    {item.content}
                  </div>

                  {item.isDeferred && item.deferUntil && (
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 11, color: '#e8a820', marginTop: 6,
                      background: 'rgba(232,168,32,0.08)', padding: '3px 8px', borderRadius: 6,
                    }}>
                      <Clock size={11} /> Deferred: {item.deferUntil}
                      <button onClick={(e) => { e.stopPropagation(); undeferItem(item.id) }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e8a820', fontSize: 11, padding: 0 }}>
                        <X size={11} />
                      </button>
                    </div>
                  )}

                  {expandedItem === item.id && (
                    <div style={{
                      display: 'flex', gap: 8, marginTop: 10,
                      animation: 'slack-slide-up 150ms var(--slack-ease-bounce) forwards',
                    }}>
                      <button onClick={(e) => { e.stopPropagation(); markDone(item.id) }} style={{
                        background: '#2bac76', border: 'none', borderRadius: 8,
                        padding: '6px 14px', color: '#fff', fontSize: 12, fontWeight: 600,
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                      }}><Check size={14} /> Done</button>

                      <div style={{ position: 'relative' }}>
                        <button onClick={(e) => { e.stopPropagation(); setShowDeferMenu(showDeferMenu === item.id ? null : item.id) }} style={{
                          background: 'none', border: '1px solid var(--mm-border)',
                          borderRadius: 8, padding: '6px 14px', fontSize: 12,
                          cursor: 'pointer', color: 'var(--mm-text)', display: 'flex', alignItems: 'center', gap: 4,
                        }}><Clock size={14} /> Later</button>

                        {showDeferMenu === item.id && (
                          <div style={{
                            position: 'absolute', top: '100%', left: 0, marginTop: 4,
                            background: 'var(--mm-main-bg)', borderRadius: 12,
                            boxShadow: 'var(--slack-shadow-modal)', padding: 6, width: 200, zIndex: 100,
                            animation: 'slack-slide-up 150ms var(--slack-ease-bounce) forwards',
                          }}>
                            {DEFER_OPTIONS.map(opt => (
                              <button key={opt.label} onClick={(e) => { e.stopPropagation(); deferItem(item.id, opt.label) }} className="aae-hoverable" style={{
                                width: '100%', padding: '8px 12px', borderRadius: 8,
                                border: 'none', background: 'none', textAlign: 'left',
                                fontSize: 13, cursor: 'pointer', color: 'var(--mm-text)',
                              }}
                              >{opt.label}</button>
                            ))}
                          </div>
                        )}
                      </div>

                      {item.channelId && onNavigateToChannel && (
                        <button onClick={(e) => { e.stopPropagation(); onNavigateToChannel(item.channelId) }} style={{
                          background: 'none', border: '1px solid var(--mm-border)',
                          borderRadius: 8, padding: '6px 14px', fontSize: 12,
                          cursor: 'pointer', color: 'var(--mm-link)',
                          display: 'flex', alignItems: 'center', gap: 4,
                        }}>Go to message <ChevronRight size={14} /></button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
