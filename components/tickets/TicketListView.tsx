'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowDown, ArrowUp, Building, ChevronDown, ChevronRight, ChevronUp,
  ClipboardList, Clock, MessageSquare, Monitor, Shield, SortAsc, SortDesc,
  TrendingUp, User, Users, Wallet
} from 'lucide-react'
import type { Ticket } from './TicketsPanel'
import {
  STATUS_CONFIG, PRIORITY_CONFIG, CATEGORY_CONFIG,
  type TicketStatus, type TicketPriority
} from '@/lib/enterprise/slaEngine'

// ── Types ───────────────────────────────────────────────────────────────────

interface ListProps {
  tickets: Ticket[]
  viewerIsIt: boolean
  onSelect: (id: string) => void
  userMap: Record<string, { id: string; username: string; first_name: string; last_name: string }>
}

type SortKey = 'priority' | 'status' | 'created' | 'updated' | 'sla' | 'title'
type SortDir = 'asc' | 'desc'

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const STATUS_RANK: Record<string, number> = { open: 0, pending: 1, in_progress: 2, resolved: 3, closed: 4 }

function displayUser(u: { first_name?: string; last_name?: string; username?: string }) {
  const full = `${u.first_name || ''} ${u.last_name || ''}`.trim()
  return full || u.username || '?'
}

function initials(u: { first_name?: string; last_name?: string; username?: string }) {
  const f = (u.first_name || '').charAt(0).toUpperCase()
  const l = (u.last_name || '').charAt(0).toUpperCase()
  return f && l ? `${f}${l}` : (u.username || '?').charAt(0).toUpperCase()
}

function slaDisplay(t: Ticket): { text: string; cls: string } | null {
  const due = t.sla_due_at || t.slaDueAt || t.sla_breach_at
  if (!due || due <= 0) return null
  const now = Date.now()
  if (t.status === 'resolved' || t.status === 'closed') {
    return { text: 'Done', cls: 'list-sla list-sla--met' }
  }
  const remaining = due - now
  if (remaining <= 0) return { text: 'Breached', cls: 'list-sla list-sla--breached' }
  const hrs = Math.floor(remaining / 3600000)
  const mins = Math.floor((remaining % 3600000) / 60000)
  if (hrs < 1) return { text: `${mins}m left`, cls: 'list-sla list-sla--warn' }
  if (hrs < 4) return { text: `${hrs}h ${mins}m`, cls: 'list-sla list-sla--warn' }
  return { text: `${hrs}h left`, cls: 'list-sla list-sla--ok' }
}

function priorityIcon(p: string) {
  switch (p) {
    case 'critical': return <AlertTriangle size={13} strokeWidth={2.5} />
    case 'high': return <ArrowUp size={13} strokeWidth={2.5} />
    case 'low': return <ArrowDown size={13} strokeWidth={2.5} />
    default: return <ChevronRight size={13} strokeWidth={2} />
  }
}

const CAT_ICON_MAP: Record<string, React.ReactNode> = {
  'clipboard-list': <ClipboardList size={12} />,
  'monitor':        <Monitor size={12} />,
  'users':          <Users size={12} />,
  'wallet':         <Wallet size={12} />,
  'trending-up':    <TrendingUp size={12} />,
  'building':       <Building size={12} />,
  'shield':         <Shield size={12} />,
}

// ── Column Header ───────────────────────────────────────────────────────────

function SortHeader({ label, sortKey, currentSort, currentDir, onSort }: {
  label: string; sortKey: SortKey; currentSort: SortKey; currentDir: SortDir
  onSort: (key: SortKey) => void
}) {
  const active = currentSort === sortKey
  return (
    <th className="list-th" onClick={() => onSort(sortKey)}>
      <span className="list-th-inner">
        {label}
        {active ? (
          currentDir === 'asc'
            ? <SortAsc size={12} strokeWidth={2} className="list-sort-icon" />
            : <SortDesc size={12} strokeWidth={2} className="list-sort-icon" />
        ) : null}
      </span>
    </th>
  )
}

// ── Main Export ──────────────────────────────────────────────────────────────

export function TicketListView({ tickets, viewerIsIt, onSelect, userMap }: ListProps) {
  const [sortKey, setSortKey] = useState<SortKey>('created')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 25

  const toggleSort = useCallback((key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
    setPage(0)
  }, [sortKey])

  const sorted = useMemo(() => {
    const arr = [...tickets]
    const dir = sortDir === 'asc' ? 1 : -1

    arr.sort((a, b) => {
      switch (sortKey) {
        case 'priority':
          return ((PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2)) * dir
        case 'status':
          return ((STATUS_RANK[a.status] ?? 0) - (STATUS_RANK[b.status] ?? 0)) * dir
        case 'title':
          return a.title.localeCompare(b.title) * dir
        case 'updated':
          return ((a.updatedAt || a.createdAt) - (b.updatedAt || b.createdAt)) * dir
        case 'sla': {
          const aDue = a.sla_due_at || a.slaDueAt || a.sla_breach_at || Infinity
          const bDue = b.sla_due_at || b.slaDueAt || b.sla_breach_at || Infinity
          return (aDue - bDue) * dir
        }
        case 'created':
        default:
          return (a.createdAt - b.createdAt) * dir
      }
    })
    return arr
  }, [tickets, sortKey, sortDir])

  const pageTickets = useMemo(() => {
    return sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  }, [sorted, page])

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)

  return (
    <div className="ticket-list-view">
      <div className="ticket-list-scroll">
        <table className="ticket-list-table">
          <thead>
            <tr>
              <SortHeader label="Priority" sortKey="priority" currentSort={sortKey} currentDir={sortDir} onSort={toggleSort} />
              <SortHeader label="Title" sortKey="title" currentSort={sortKey} currentDir={sortDir} onSort={toggleSort} />
              <SortHeader label="Status" sortKey="status" currentSort={sortKey} currentDir={sortDir} onSort={toggleSort} />
              <th className="list-th">Category</th>
              <th className="list-th">Assignee</th>
              <SortHeader label="SLA" sortKey="sla" currentSort={sortKey} currentDir={sortDir} onSort={toggleSort} />
              <SortHeader label="Created" sortKey="created" currentSort={sortKey} currentDir={sortDir} onSort={toggleSort} />
              <SortHeader label="Updated" sortKey="updated" currentSort={sortKey} currentDir={sortDir} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {pageTickets.length === 0 ? (
              <tr><td colSpan={8} className="list-empty">No tickets match the current filters.</td></tr>
            ) : (
              pageTickets.map(t => {
                const priCfg = PRIORITY_CONFIG[(t.priority || 'medium') as TicketPriority]
                const statusCfg = STATUS_CONFIG[(t.status || 'open') as TicketStatus]
                const catCfg = CATEGORY_CONFIG[(t.category || 'general') as keyof typeof CATEGORY_CONFIG] || CATEGORY_CONFIG.general
                const sla = slaDisplay(t)
                const assignee = t.assigneeId ? userMap[t.assigneeId] : null

                return (
                  <tr
                    key={t.id}
                    className="list-row"
                    onClick={() => onSelect(t.id)}
                    tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(t.id) } }}
                  >
                    <td className="list-td list-td-priority">
                      <span className="list-priority-badge" style={{ color: priCfg?.color }}>
                        {priorityIcon(t.priority)}
                        <span>{priCfg?.label || t.priority}</span>
                      </span>
                    </td>
                    <td className="list-td list-td-title">
                      <span className="list-title-text">{t.title}</span>
                      <span className="list-id-sub">{t.id.length > 14 ? `${t.id.slice(0, 14)}…` : t.id}</span>
                    </td>
                    <td className="list-td">
                      <span className="list-status-pill" style={{ background: statusCfg?.color + '22', color: statusCfg?.color, borderColor: statusCfg?.color + '44' }}>
                        {statusCfg?.label || t.status}
                      </span>
                    </td>
                    <td className="list-td list-td-cat">
                      <span>{CAT_ICON_MAP[catCfg.iconKey] || <ClipboardList size={12} />} {catCfg.label}</span>
                    </td>
                    <td className="list-td list-td-assignee">
                      {assignee ? (
                        <span className="list-assignee">
                          <span className="list-avatar">{initials(assignee)}</span>
                          <span>{displayUser(assignee)}</span>
                        </span>
                      ) : (
                        <span className="list-unassigned">—</span>
                      )}
                    </td>
                    <td className="list-td">
                      {sla ? (
                        <span className={sla.cls}>
                          <Clock size={11} strokeWidth={2} />
                          {sla.text}
                        </span>
                      ) : <span className="list-unassigned">—</span>}
                    </td>
                    <td className="list-td list-td-date">
                      {new Date(t.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </td>
                    <td className="list-td list-td-date">
                      {t.updatedAt ? new Date(t.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—'}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="list-pagination">
          <button className="list-page-btn" disabled={page <= 0} onClick={() => setPage(p => p - 1)}>
            <ChevronUp size={14} style={{ transform: 'rotate(-90deg)' }} /> Prev
          </button>
          <span className="list-page-info">
            Page {page + 1} of {totalPages} · {sorted.length} tickets
          </span>
          <button className="list-page-btn" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
            Next <ChevronUp size={14} style={{ transform: 'rotate(90deg)' }} />
          </button>
        </div>
      )}
    </div>
  )
}
