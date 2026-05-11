'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowDown, ArrowUp, Building, Calendar, ChevronDown, ChevronRight,
  ClipboardList, Clock, Eye, GripVertical, MessageSquare, Monitor, Shield, TrendingUp,
  User, Users, Wallet
} from 'lucide-react'
import type { Ticket } from './TicketsPanel'
import {
  STATUS_CONFIG, PRIORITY_CONFIG, CATEGORY_CONFIG,
  type TicketStatus, type TicketPriority
} from '@/lib/slaEngine'

// ── Types ───────────────────────────────────────────────────────────────────

interface KanbanProps {
  tickets: Ticket[]
  viewerIsIt: boolean
  onSelect: (id: string) => void
  onStatusChange: (id: string, status: TicketStatus) => void
  userMap: Record<string, { id: string; username: string; first_name: string; last_name: string }>
}

const COLUMN_ORDER: TicketStatus[] = ['open', 'pending', 'in_progress', 'resolved', 'closed']

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
    return { text: 'Done', cls: 'kanban-sla kanban-sla--met' }
  }
  const remaining = due - now
  if (remaining <= 0) return { text: 'Breached', cls: 'kanban-sla kanban-sla--breached' }
  const hrs = Math.floor(remaining / 3600000)
  const mins = Math.floor((remaining % 3600000) / 60000)
  if (hrs < 1) return { text: `${mins}m`, cls: 'kanban-sla kanban-sla--warn' }
  if (hrs < 4) return { text: `${hrs}h ${mins}m`, cls: 'kanban-sla kanban-sla--warn' }
  return { text: `${hrs}h`, cls: 'kanban-sla kanban-sla--ok' }
}

function priorityIcon(p: string) {
  switch (p) {
    case 'critical': return <AlertTriangle size={12} strokeWidth={2.5} />
    case 'high': return <ArrowUp size={12} strokeWidth={2.5} />
    case 'low': return <ArrowDown size={12} strokeWidth={2.5} />
    default: return <ChevronRight size={12} strokeWidth={2} />
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

// ── Kanban Card ─────────────────────────────────────────────────────────────

function KanbanCard({
  ticket, userMap, onSelect, dragging
}: {
  ticket: Ticket
  userMap: KanbanProps['userMap']
  onSelect: (id: string) => void
  dragging: boolean
}) {
  const sla = slaDisplay(ticket)
  const priCfg = PRIORITY_CONFIG[(ticket.priority || 'medium') as TicketPriority]
  const catCfg = CATEGORY_CONFIG[(ticket.category || 'general') as keyof typeof CATEGORY_CONFIG] || CATEGORY_CONFIG.general
  const assignee = ticket.assigneeId ? userMap[ticket.assigneeId] : null

  return (
    <div
      className={`kanban-card${dragging ? ' kanban-card--dragging' : ''}`}
      onClick={() => onSelect(ticket.id)}
      draggable
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(ticket.id) } }}
    >
      <div className="kanban-card-top">
        <span className="kanban-card-priority" style={{ color: priCfg?.color || '#888' }} title={priCfg?.label}>
          {priorityIcon(ticket.priority)}
        </span>
        <span className="kanban-card-id">{ticket.id.length > 12 ? ticket.id.slice(0, 12) : ticket.id}</span>
        {sla && <span className={sla.cls}><Clock size={10} strokeWidth={2} />{sla.text}</span>}
      </div>
      <p className="kanban-card-title">{ticket.title}</p>
      {ticket.description ? (
        <p className="kanban-card-desc">{ticket.description.replace(/<[^>]+>/g, '').slice(0, 80)}</p>
      ) : null}
      <div className="kanban-card-footer">
        <span className="kanban-card-cat" title={catCfg.label}>
          {CAT_ICON_MAP[catCfg.iconKey] || <ClipboardList size={12} />} {catCfg.label}
        </span>
        <div className="kanban-card-footer-right">
          {assignee ? (
            <span className="kanban-card-avatar" title={displayUser(assignee)}>
              {initials(assignee)}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

// ── Kanban Column ───────────────────────────────────────────────────────────

function KanbanColumn({
  status, tickets, userMap, onSelect, onDrop, viewerIsIt, collapsed, onToggle
}: {
  status: TicketStatus
  tickets: Ticket[]
  userMap: KanbanProps['userMap']
  onSelect: (id: string) => void
  onDrop: (ticketId: string, status: TicketStatus) => void
  viewerIsIt: boolean
  collapsed: boolean
  onToggle: () => void
}) {
  const cfg = STATUS_CONFIG[status]
  const [dragOver, setDragOver] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!viewerIsIt) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(true)
  }, [viewerIsIt])

  const handleDragLeave = useCallback(() => setDragOver(false), [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (!viewerIsIt) return
    const ticketId = e.dataTransfer.getData('text/plain')
    if (ticketId) onDrop(ticketId, status)
  }, [viewerIsIt, onDrop, status])

  return (
    <div
      className={`kanban-column${dragOver ? ' kanban-column--dragover' : ''}${collapsed ? ' kanban-column--collapsed' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <button className="kanban-column-header" onClick={onToggle} type="button">
        <span className="kanban-column-dot" style={{ background: cfg.color }} />
        <span className="kanban-column-title">{cfg.label}</span>
        <span className="kanban-column-count">{tickets.length}</span>
        <ChevronDown size={14} className={`kanban-column-chevron${collapsed ? ' kanban-column-chevron--collapsed' : ''}`} />
      </button>
      {!collapsed && (
        <div className="kanban-column-body">
          {tickets.length === 0 ? (
            <p className="kanban-empty">No tickets</p>
          ) : (
            tickets.map(t => (
              <div
                key={t.id}
                draggable={viewerIsIt}
                onDragStart={e => {
                  e.dataTransfer.setData('text/plain', t.id)
                  e.dataTransfer.effectAllowed = 'move'
                }}
              >
                <KanbanCard
                  ticket={t}
                  userMap={userMap}
                  onSelect={onSelect}
                  dragging={false}
                />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Export ──────────────────────────────────────────────────────────────

export function TicketKanbanBoard({ tickets, viewerIsIt, onSelect, onStatusChange, userMap }: KanbanProps) {
  const [collapsedCols, setCollapsedCols] = useState<Set<string>>(new Set())

  const columnTickets = useMemo(() => {
    const map: Record<string, Ticket[]> = {}
    for (const s of COLUMN_ORDER) map[s] = []
    for (const t of tickets) {
      const s = t.status || 'open'
      if (map[s]) map[s].push(t)
      else if (map.open) map.open.push(t)
    }
    return map
  }, [tickets])

  const toggleCol = useCallback((s: string) => {
    setCollapsedCols(prev => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }, [])

  const handleDrop = useCallback((ticketId: string, newStatus: TicketStatus) => {
    const ticket = tickets.find(t => t.id === ticketId)
    if (!ticket || ticket.status === newStatus) return
    onStatusChange(ticketId, newStatus)
  }, [tickets, onStatusChange])

  return (
    <div className="kanban-board">
      {COLUMN_ORDER.map(status => (
        <KanbanColumn
          key={status}
          status={status}
          tickets={columnTickets[status] || []}
          userMap={userMap}
          onSelect={onSelect}
          onDrop={handleDrop}
          viewerIsIt={viewerIsIt}
          collapsed={collapsedCols.has(status)}
          onToggle={() => toggleCol(status)}
        />
      ))}
    </div>
  )
}
