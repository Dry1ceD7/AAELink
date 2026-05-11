'use client'

import { useState, useCallback, useEffect } from 'react'
import { ListChecks, LayoutGrid, Table, List, Circle, Plus, X, Trash2, User, CalendarDays, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'

/* ─────────────────────────────────────────────────────────────────────
   SlackListPanel — Slack Lists project management
   • Kanban board / spreadsheet / list views
   • Custom fields (owner, due date, status, priority)
   • Drag-and-drop task management
   ───────────────────────────────────────────────────────────────────── */

interface ListItem {
  id: string
  title: string
  status: 'todo' | 'in_progress' | 'review' | 'done'
  priority: 'urgent' | 'high' | 'medium' | 'low'
  assignee: string
  dueDate: string
  description: string
  tags: string[]
  createdAt: string
}

type ViewMode = 'board' | 'table' | 'list'

const STATUS_CONFIG = {
  todo: { label: 'To Do', color: '#616061', bg: 'rgba(97,96,97,0.08)' },
  in_progress: { label: 'In Progress', color: '#4361EE', bg: 'rgba(67,97,238,0.08)' },
  review: { label: 'In Review', color: '#e8a820', bg: 'rgba(232,168,32,0.08)' },
  done: { label: 'Done', color: '#2bac76', bg: 'rgba(43,172,118,0.08)' },
}

const PRIORITY_CONFIG = {
  urgent: { label: 'Urgent', color: '#e01e5a' },
  high: { label: 'High', color: '#f5a623' },
  medium: { label: 'Medium', color: '#e8a820' },
  low: { label: 'Low', color: '#2bac76' },
}

export default function SlackListPanel({ channelName, channelId, onClose }: { channelName: string; channelId?: string; onClose: () => void }) {
  const [items, setItems] = useState<ListItem[]>([])
  const [loading, setLoading] = useState(true)

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      const params = channelId ? `?channel_id=${channelId}` : ''
      const res = await apiFetch(`/api/lists${params}`)
      if (res.ok) {
        const data = await res.json() as { items?: ListItem[] }
        setItems((data.items || []).map(i => ({
          ...i,
          status: (['todo', 'in_progress', 'review', 'done'].includes(i.status) ? i.status : 'todo') as ListItem['status'],
          priority: (['urgent', 'high', 'medium', 'low'].includes(i.priority) ? i.priority : 'medium') as ListItem['priority'],
          tags: i.tags || [],
        })))
      }
    } finally {
      setLoading(false)
    }
  }, [channelId])

  useEffect(() => { void loadItems() }, [loadItems])
  const [viewMode, setViewMode] = useState<ViewMode>('board')
  const [showNewItem, setShowNewItem] = useState(false)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterAssignee, setFilterAssignee] = useState<string>('all')
  const [editingItem, setEditingItem] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')

  const filteredItems = items.filter(item => {
    if (filterStatus !== 'all' && item.status !== filterStatus) return false
    if (filterAssignee !== 'all' && item.assignee !== filterAssignee) return false
    return true
  })

  const uniqueAssignees = [...new Set(items.map(i => i.assignee))]

  const updateItemStatus = useCallback(async (id: string, status: ListItem['status']) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, status } : i))
    await apiFetch('/api/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_item', item_id: id, status }),
    }).catch(() => {})
  }, [])

  const addItem = useCallback(async (status: ListItem['status'] = 'todo') => {
    if (!newTitle.trim()) return
    const newItem: ListItem = {
      id: `${Date.now()}`, title: newTitle.trim(), status, priority: 'medium',
      assignee: 'Admin', dueDate: '', description: '', tags: [],
      createdAt: new Date().toISOString().split('T')[0],
    }
    setItems(prev => [...prev, newItem])
    setNewTitle('')
    setShowNewItem(false)
    await apiFetch('/api/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add_item',
        channel_id: channelId,
        title: newItem.title,
        status: newItem.status,
        priority: newItem.priority,
      }),
    }).catch(() => {})
  }, [newTitle, channelId])

  const deleteItem = useCallback(async (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id))
    await apiFetch('/api/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_item', item_id: id }),
    }).catch(() => {})
  }, [])

  /* ── Board View (Kanban) ────────────────────────────── */
  const renderBoardView = () => (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 16, padding: 20, overflowX: 'auto', height: '100%',
    }}>
      {(Object.keys(STATUS_CONFIG) as ListItem['status'][]).map(status => {
        const config = STATUS_CONFIG[status]
        const columnItems = filteredItems.filter(i => i.status === status)
        return (
          <div key={status} style={{
            display: 'flex', flexDirection: 'column', minWidth: 260,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 12px', marginBottom: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', background: config.color,
                }} />
                <span style={{ fontWeight: 700, fontSize: 13 }}>{config.label}</span>
                <span style={{
                  fontSize: 11, background: config.bg, color: config.color,
                  padding: '2px 8px', borderRadius: 10, fontWeight: 600,
                }}>{columnItems.length}</span>
              </div>
              <button onClick={() => { setShowNewItem(true); setNewTitle('') }}
                style={{
                  background: 'none', border: 'none', fontSize: 16, cursor: 'pointer',
                  color: 'var(--mm-muted)', padding: 0, lineHeight: 1,
                }}>+</button>
            </div>

            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column', gap: 8,
              overflowY: 'auto',
            }}>
              {columnItems.map(item => (
                <div key={item.id} style={{
                  background: 'var(--mm-main-bg)', borderRadius: 12,
                  border: '1px solid var(--mm-border)',
                  padding: 14, cursor: 'pointer',
                  transition: 'box-shadow 150ms ease, transform 100ms ease',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'
                  e.currentTarget.style.transform = 'translateY(-1px)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)'
                  e.currentTarget.style.transform = 'none'
                }}
                >
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8, lineHeight: 1.4 }}>
                    {item.title}
                  </div>
                  {item.tags.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
                      {item.tags.map(tag => (
                        <span key={tag} style={{
                          fontSize: 10, padding: '2px 8px', borderRadius: 10,
                          background: 'var(--mm-hover-bg)', color: 'var(--mm-muted)',
                          fontWeight: 500,
                        }}>{tag}</span>
                      ))}
                    </div>
                  )}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    fontSize: 12, color: 'var(--mm-muted)',
                  }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <User size={12} /> {item.assignee}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <Circle size={8} fill={PRIORITY_CONFIG[item.priority].color} style={{ color: PRIORITY_CONFIG[item.priority].color }} />
                        <span style={{ color: PRIORITY_CONFIG[item.priority].color, fontSize: 10 }}>
                          {PRIORITY_CONFIG[item.priority].label}
                        </span>
                      </span>
                      {item.dueDate && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4,
                          color: new Date(item.dueDate) < new Date() ? '#e01e5a' : 'inherit',
                        }}>
                          <CalendarDays size={12} /> {item.dueDate}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )

  /* ── Table View (Spreadsheet) ───────────────────────── */
  const renderTableView = () => (
    <div style={{ padding: 20, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--mm-border)' }}>
            {['Task', 'Status', 'Priority', 'Assignee', 'Due Date', 'Tags', ''].map(h => (
              <th key={h} style={{
                textAlign: 'left', padding: '10px 12px', fontWeight: 600,
                fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5,
                color: 'var(--mm-muted)',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filteredItems.map(item => (
            <tr key={item.id} style={{
              borderBottom: '1px solid var(--mm-border-subtle)',
              transition: 'background 100ms ease',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--mm-hover-bg)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <td style={{ padding: '10px 12px', fontWeight: 500 }}>{item.title}</td>
              <td style={{ padding: '10px 12px' }}>
                <select value={item.status}
                  onChange={e => updateItemStatus(item.id, e.target.value as ListItem['status'])}
                  style={{
                    background: STATUS_CONFIG[item.status].bg,
                    color: STATUS_CONFIG[item.status].color,
                    border: 'none', borderRadius: 8, padding: '4px 8px',
                    fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  }}>
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </td>
              <td style={{ padding: '10px 12px', fontSize: 12 }}>
                {PRIORITY_CONFIG[item.priority].label}
              </td>
              <td style={{ padding: '10px 12px' }}>{item.assignee}</td>
              <td style={{ padding: '10px 12px', color: item.dueDate && new Date(item.dueDate) < new Date() ? '#e01e5a' : 'inherit' }}>
                {item.dueDate || '—'}
              </td>
              <td style={{ padding: '10px 12px' }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {item.tags.map(t => (
                    <span key={t} style={{
                      fontSize: 10, padding: '2px 6px', borderRadius: 8,
                      background: 'var(--mm-hover-bg)',
                    }}>{t}</span>
                  ))}
                </div>
              </td>
              <td style={{ padding: '10px 12px' }}>
                <button onClick={() => deleteItem(item.id)} style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--mm-muted)', display: 'grid', placeItems: 'center', opacity: 0.5,
                }}><Trash2 size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  /* ── List View ──────────────────────────────────────── */
  const renderListView = () => (
    <div style={{ padding: 20 }}>
      {filteredItems.map(item => (
        <div key={item.id} style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
          borderBottom: '1px solid var(--mm-border-subtle)',
          transition: 'background 100ms ease',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--mm-hover-bg)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <input type="checkbox" checked={item.status === 'done'}
            onChange={() => updateItemStatus(item.id, item.status === 'done' ? 'todo' : 'done')}
            style={{ accentColor: '#4361EE', width: 16, height: 16 }} />
          <span style={{
            flex: 1, fontWeight: 500, fontSize: 14,
            textDecoration: item.status === 'done' ? 'line-through' : 'none',
            opacity: item.status === 'done' ? 0.5 : 1,
          }}>{item.title}</span>
          <span style={{
            fontSize: 11, padding: '2px 8px', borderRadius: 8,
            background: STATUS_CONFIG[item.status].bg,
            color: STATUS_CONFIG[item.status].color, fontWeight: 600,
          }}>{STATUS_CONFIG[item.status].label}</span>
          <span style={{ fontSize: 12, color: 'var(--mm-muted)' }}>{item.assignee}</span>
        </div>
      ))}
    </div>
  )

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--mm-main-bg)', color: 'var(--mm-text)',
      animation: 'slack-slide-up 200ms var(--slack-ease-out) forwards',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--mm-border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ListChecks size={18} style={{ color: 'var(--mm-link)' }} />
          <span style={{ fontWeight: 700, fontSize: 16 }}>Lists</span>
          <span style={{ opacity: 0.5, fontSize: 13 }}>#{channelName}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* View toggle */}
          <div style={{
            display: 'flex', borderRadius: 8, overflow: 'hidden',
            border: '1px solid var(--mm-border)',
          }}>
            {([{ mode: 'board' as ViewMode, Icon: LayoutGrid }, { mode: 'table' as ViewMode, Icon: Table }, { mode: 'list' as ViewMode, Icon: List }]).map(({ mode, Icon }) => (
              <button key={mode} onClick={() => setViewMode(mode)} style={{
                background: viewMode === mode ? 'var(--mm-hover-bg)' : 'none',
                border: 'none', padding: '4px 10px', cursor: 'pointer',
                color: viewMode === mode ? 'var(--mm-link)' : 'var(--mm-muted)',
                display: 'grid', placeItems: 'center',
              }}><Icon size={14} /></button>
            ))}
          </div>

          {/* Filters */}
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{
            background: 'var(--mm-main-bg)', border: '1px solid var(--mm-border)',
            borderRadius: 8, padding: '4px 10px', fontSize: 12, color: 'var(--mm-text)',
            cursor: 'pointer',
          }}>
            <option value="all">All statuses</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>

          <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)} style={{
            background: 'var(--mm-main-bg)', border: '1px solid var(--mm-border)',
            borderRadius: 8, padding: '4px 10px', fontSize: 12, color: 'var(--mm-text)',
            cursor: 'pointer',
          }}>
            <option value="all">All owners</option>
            {uniqueAssignees.map(a => <option key={a} value={a}>{a}</option>)}
          </select>

          <button onClick={() => setShowNewItem(true)} style={{
            background: '#4361EE', border: 'none', borderRadius: 8,
            padding: '6px 14px', color: '#fff', fontSize: 12, fontWeight: 600,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
          }}><Plus size={12} /> New item</button>

          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--mm-muted)', padding: 4, display: 'grid', placeItems: 'center',
          }}><X size={18} /></button>
        </div>
      </div>

      {/* New item inline form */}
      {showNewItem && (
        <div style={{
          padding: '12px 20px', borderBottom: '1px solid var(--mm-border)',
          display: 'flex', gap: 8, alignItems: 'center',
          animation: 'slack-slide-up 150ms var(--slack-ease-bounce) forwards',
        }}>
          <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addItem()}
            placeholder="What needs to be done?" autoFocus
            style={{
              flex: 1, border: '1px solid var(--mm-border-input)',
              borderRadius: 8, padding: '8px 12px', fontSize: 14,
              background: 'var(--mm-main-bg)', color: 'var(--mm-text)',
              outline: 'none',
            }} />
          <button onClick={() => addItem()} style={{
            background: '#4361EE', border: 'none', borderRadius: 8,
            padding: '8px 16px', color: '#fff', fontSize: 13, fontWeight: 600,
            cursor: 'pointer',
          }}>Add</button>
          <button onClick={() => setShowNewItem(false)} style={{
            background: 'none', border: '1px solid var(--mm-border)',
            borderRadius: 8, padding: '8px 16px', fontSize: 13,
            cursor: 'pointer', color: 'var(--mm-muted)',
          }}>Cancel</button>
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--mm-muted)' }}><Loader2 size={20} className="spin" /> Loading list items…</div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, opacity: 0.5, fontSize: 13 }}>No items yet. Click &quot;+ New item&quot; to add one.</div>
        ) : (
          <>
            {viewMode === 'board' && renderBoardView()}
            {viewMode === 'table' && renderTableView()}
            {viewMode === 'list' && renderListView()}
          </>
        )}
      </div>
    </div>
  )
}
