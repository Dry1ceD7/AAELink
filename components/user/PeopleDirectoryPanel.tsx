'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api/apiClient'
import { Users, Search, LayoutGrid, List, X, MessageSquare, Headphones, Mail, Phone, MapPin, Clock, Calendar, Loader2 } from 'lucide-react'

/* ─────────────────────────────────────────────────────────────────────
   PeopleDirectoryPanel — Wired to /api/search/users + /api/collab/users
   ───────────────────────────────────────────────────────────────────── */

interface Employee {
  id: string
  username: string
  first_name: string
  last_name: string
  email: string
  avatar_url?: string
  job_title?: string
  phone?: string
  department?: string
  timezone?: string
  status_text?: string
  status_emoji?: string
  platform_role?: string
  pronouns?: string
  presence_status?: string
}

const STATUS_COLORS: Record<string, string> = {
  online: '#2bac76', away: '#e8a820', dnd: '#e01e5a', offline: '#616061',
}

type ViewMode = 'grid' | 'list'

export default function PeopleDirectoryPanel({ onClose, onStartDM }: {
  onClose: () => void
  onStartDM?: (userId: string) => void
}) {
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [filterDept, setFilterDept] = useState('all')
  const [people, setPeople] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null)

  /* ── Load all users on mount ─────────────────────── */
  const loadPeople = useCallback(async (q?: string) => {
    try {
      setLoading(true)
      // Use collab/users for full list, or search/users for filtered
      const url = q && q.length >= 1
        ? `/api/search/users?q=${encodeURIComponent(q)}&limit=50`
        : '/api/collab/users'
      const res = await apiFetch(url)
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setPeople(data.users || [])
    } catch {
      setPeople([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadPeople() }, [loadPeople])

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => loadPeople(search), 300)
    return () => clearTimeout(t)
  }, [search, loadPeople])

  const departments = [...new Set(people.filter(e => e.department).map(e => e.department!))]

  const filtered = people.filter(e => {
    if (filterDept !== 'all' && e.department !== filterDept) return false
    return true
  })

  const selectedEmployee = selectedPerson ? people.find(e => e.id === selectedPerson) : null
  const displayName = (e: Employee) => `${e.first_name || ''} ${e.last_name || ''}`.trim() || e.username
  const initials = (e: Employee) => {
    const n = displayName(e)
    return n.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
  }
  const presenceColor = (e: Employee) => STATUS_COLORS[e.presence_status || 'offline'] || STATUS_COLORS.offline

  /* ── Profile Card ──────────────────────────────────── */
  const renderProfileCard = (emp: Employee) => (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.5)',
      animation: 'slack-fade-in 200ms ease forwards',
    }} onClick={() => setSelectedPerson(null)}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--mm-main-bg)', borderRadius: 16,
        boxShadow: 'var(--slack-shadow-modal)',
        width: 420, maxWidth: '90vw', overflow: 'hidden',
        animation: 'slack-modal-in 300ms var(--slack-ease-bounce) forwards',
      }}>
        <div style={{ height: 80, background: 'linear-gradient(135deg, #12086F, #4361EE, #4CC9F0)' }} />
        <div style={{ padding: '0 24px 24px', marginTop: -32 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 16,
            background: 'linear-gradient(135deg, #2B35AF, #4CC9F0)',
            display: 'grid', placeItems: 'center', fontSize: 28, fontWeight: 700, color: '#fff',
            border: '4px solid var(--mm-main-bg)', marginBottom: 12,
          }}>
            {initials(emp)}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{displayName(emp)}</h3>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: presenceColor(emp) }} />
            {emp.pronouns && <span style={{ fontSize: 12, opacity: 0.4 }}>({emp.pronouns})</span>}
          </div>
          <div style={{ fontSize: 14, opacity: 0.7, marginBottom: 4 }}>{emp.job_title || 'Team Member'}</div>

          {emp.status_text && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 13, padding: '4px 10px', borderRadius: 8,
              background: 'var(--mm-hover-bg)', marginBottom: 12,
            }}>
              <span>{emp.status_text}</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12, marginBottom: 16 }}>
            <button onClick={() => onStartDM?.(emp.id)} style={{
              flex: 1, background: '#4361EE', border: 'none', borderRadius: 8,
              padding: '8px 0', color: '#fff', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}><MessageSquare size={14} /> Message</button>
            <button style={{
              flex: 1, background: 'none', border: '1px solid var(--mm-border)',
              borderRadius: 8, padding: '8px 0', fontSize: 13,
              cursor: 'pointer', color: 'var(--mm-text)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}><Headphones size={14} /> Huddle</button>
          </div>

          <div style={{ borderTop: '1px solid var(--mm-border)', paddingTop: 16 }}>
            {[
              { icon: Users, label: 'Department', value: emp.department || '—' },
              { icon: Mail, label: 'Email', value: emp.email },
              { icon: Phone, label: 'Phone', value: emp.phone || '—' },
              { icon: Clock, label: 'Timezone', value: emp.timezone || '—' },
              { icon: MapPin, label: 'Role', value: emp.platform_role || 'member' },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0',
                fontSize: 13, borderBottom: '1px solid var(--mm-border-subtle)',
              }}>
                <Icon size={14} style={{ opacity: 0.4, flexShrink: 0 }} />
                <span style={{ opacity: 0.5, minWidth: 80 }}>{label}</span>
                <span style={{ fontWeight: 500, marginLeft: 'auto' }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )

  /* ── Grid View ─────────────────────────────────────── */
  const renderGridView = () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14, padding: 20 }}>
      {filtered.map(emp => (
        <div key={emp.id} onClick={() => setSelectedPerson(emp.id)} className="aae-hoverable aae-hover-pop" style={{
          background: 'var(--mm-main-bg)', borderRadius: 12,
          border: '1px solid var(--mm-border)', padding: 20,
          cursor: 'pointer', textAlign: 'center',
        }}
        >
          <div style={{ position: 'relative', display: 'inline-block', marginBottom: 10 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16,
              background: 'linear-gradient(135deg, #2B35AF, #4CC9F0)',
              display: 'grid', placeItems: 'center', fontSize: 20, fontWeight: 700, color: '#fff',
            }}>
              {initials(emp)}
            </div>
            <span style={{
              position: 'absolute', bottom: -2, right: -2,
              width: 14, height: 14, borderRadius: '50%',
              background: presenceColor(emp),
              border: '3px solid var(--mm-main-bg)',
            }} />
          </div>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{displayName(emp)}</div>
          <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>{emp.job_title || 'Team Member'}</div>
          <div style={{ fontSize: 11, opacity: 0.4 }}>{emp.department || ''}</div>
        </div>
      ))}
    </div>
  )

  /* ── List View ─────────────────────────────────────── */
  const renderListView = () => (
    <div style={{ padding: '8px 0' }}>
      {filtered.map(emp => (
        <div key={emp.id} onClick={() => setSelectedPerson(emp.id)} className="aae-hoverable"
          style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px',
            cursor: 'pointer',
          }}
        >
          <div style={{ position: 'relative' }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: 'linear-gradient(135deg, #2B35AF, #4CC9F0)',
              display: 'grid', placeItems: 'center', fontSize: 15, fontWeight: 700, color: '#fff',
            }}>
              {initials(emp)}
            </div>
            <span style={{
              position: 'absolute', bottom: -1, right: -1,
              width: 12, height: 12, borderRadius: '50%',
              background: presenceColor(emp),
              border: '2px solid var(--mm-main-bg)',
            }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{displayName(emp)}</div>
            <div style={{ fontSize: 12, opacity: 0.5 }}>{emp.job_title || 'Team Member'}{emp.department ? ` · ${emp.department}` : ''}</div>
          </div>
          <div style={{ fontSize: 12, opacity: 0.4 }}>{emp.timezone || ''}</div>
          <button onClick={e => { e.stopPropagation(); onStartDM?.(emp.id) }} style={{
            background: 'none', border: '1px solid var(--mm-border)',
            borderRadius: 8, padding: '4px 12px', fontSize: 11,
            cursor: 'pointer', color: 'var(--mm-link)',
          }}>Message</button>
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
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--mm-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Users size={18} style={{ color: 'var(--mm-link)' }} />
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>People</h2>
            <span style={{ fontSize: 12, opacity: 0.4 }}>{people.length} members</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--mm-border)' }}>
              {([['grid', LayoutGrid], ['list', List]] as [ViewMode, typeof LayoutGrid][]).map(([mode, Icon]) => (
                <button key={mode} onClick={() => setViewMode(mode)} style={{
                  background: viewMode === mode ? 'var(--mm-hover-bg)' : 'none',
                  border: 'none', padding: '4px 10px', cursor: 'pointer',
                  color: viewMode === mode ? 'var(--mm-link)' : 'var(--mm-muted)',
                  display: 'grid', placeItems: 'center',
                }}><Icon size={16} /></button>
              ))}
            </div>
            <button onClick={onClose} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--mm-muted)', padding: 4,
            }}><X size={18} /></button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search people…" style={{
                width: '100%', border: '1px solid var(--mm-border)', borderRadius: 8,
                padding: '8px 12px 8px 32px', fontSize: 13, background: 'var(--mm-main-bg)',
                color: 'var(--mm-text)', outline: 'none', boxSizing: 'border-box',
              }} />
          </div>
          <select value={filterDept} onChange={e => setFilterDept(e.target.value)} style={{
            border: '1px solid var(--mm-border)', borderRadius: 8,
            padding: '0 10px', fontSize: 12, background: 'var(--mm-main-bg)',
            color: 'var(--mm-text)', cursor: 'pointer',
          }}>
            <option value="all">All departments</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, opacity: 0.5 }}>
            <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13, marginTop: 8 }}>Loading people…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, opacity: 0.5 }}>
            <Users size={36} />
            <span style={{ fontSize: 14, fontWeight: 600, marginTop: 8 }}>No people found</span>
          </div>
        ) : (
          <>
            {viewMode === 'grid' && renderGridView()}
            {viewMode === 'list' && renderListView()}
          </>
        )}
      </div>

      {selectedEmployee && renderProfileCard(selectedEmployee)}
    </div>
  )
}
