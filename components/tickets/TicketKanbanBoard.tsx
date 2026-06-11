'use client'

import { useCallback, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from 'react'
import {
  AlertTriangle, ArrowDown, ArrowUp, Building, ChevronDown, ChevronRight,
  ClipboardList, Clock, Monitor, Shield, TrendingUp, Users, Wallet
} from 'lucide-react'
import type { Ticket } from './TicketsPanel'
import {
  STATUS_CONFIG, PRIORITY_CONFIG, CATEGORY_CONFIG,
  type TicketStatus, type TicketPriority
} from '@/lib/enterprise/slaEngine'

// ── Types ───────────────────────────────────────────────────────────────────

interface KanbanProps {
  tickets: Ticket[]
  viewerIsIt: boolean
  onSelect: (id: string) => void
  /** Returns true on success, false on rejection. void counts as success (fire-and-forget callers). */
  onStatusChange: (id: string, status: TicketStatus) => Promise<boolean | void> | boolean | void
  userMap: Record<string, { id: string; username: string; first_name: string; last_name: string }>
}

interface OptimisticMove {
  ticket_id: string
  status: TicketStatus
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
  if (t.status === 'resolved' || t.status === 'closed') return { text: 'Done', cls: 'kanban-sla kanban-sla--met' }
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
    case 'high':     return <ArrowUp size={12} strokeWidth={2.5} />
    case 'low':      return <ArrowDown size={12} strokeWidth={2.5} />
    default:         return <ChevronRight size={12} strokeWidth={2} />
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

// ── Card ────────────────────────────────────────────────────────────────────

function KanbanCard({
  ticket, userMap, onSelect, dragging, lifted, onKeyboardLift,
}: {
  ticket: Ticket
  userMap: KanbanProps['userMap']
  onSelect: (id: string) => void
  dragging: boolean
  lifted: boolean
  onKeyboardLift: (id: string) => void
}) {
  const sla = slaDisplay(ticket)
  const priCfg = PRIORITY_CONFIG[(ticket.priority || 'medium') as TicketPriority]
  const catCfg = CATEGORY_CONFIG[(ticket.category || 'general') as keyof typeof CATEGORY_CONFIG] || CATEGORY_CONFIG.general
  const assignee = ticket.assigneeId ? userMap[ticket.assigneeId] : null

  return (
    <div
      className={`kanban-card${dragging ? ' kanban-card--dragging' : ''}${lifted ? ' kanban-card--lifted' : ''}`}
      onClick={() => onSelect(ticket.id)}
      role="button"
      tabIndex={0}
      aria-grabbed={lifted || undefined}
      aria-label={`Ticket ${ticket.id}, status ${ticket.status}. Press space to pick up.`}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); onSelect(ticket.id) }
        else if (e.key === ' ') { e.preventDefault(); onKeyboardLift(ticket.id) }
      }}
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
          {assignee ? <span className="kanban-card-avatar" title={displayUser(assignee)}>{initials(assignee)}</span> : null}
        </div>
      </div>
    </div>
  )
}

// ── Column ──────────────────────────────────────────────────────────────────

function KanbanColumn({
  status, tickets, userMap, onSelect, onDrop, canMove, collapsed, onToggle,
  liftedTicketId, onKeyboardLift, isKeyboardTarget,
}: {
  status: TicketStatus
  tickets: Ticket[]
  userMap: KanbanProps['userMap']
  onSelect: (id: string) => void
  onDrop: (ticketId: string, status: TicketStatus) => void
  canMove: boolean
  collapsed: boolean
  onToggle: () => void
  liftedTicketId: string | null
  onKeyboardLift: (id: string) => void
  isKeyboardTarget: boolean
}) {
  const cfg = STATUS_CONFIG[status]
  const [dragOver, setDragOver] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!canMove) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(true)
  }, [canMove])
  const handleDragLeave = useCallback(() => setDragOver(false), [])
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (!canMove) return
    const ticketId = e.dataTransfer.getData('text/plain')
    if (ticketId) onDrop(ticketId, status)
  }, [canMove, onDrop, status])

  return (
    <div
      className={`kanban-column${dragOver || isKeyboardTarget ? ' kanban-column--dragover' : ''}${collapsed ? ' kanban-column--collapsed' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      aria-dropeffect={liftedTicketId ? 'move' : undefined}
      data-status={status}
    >
      <button className="kanban-column-header" onClick={onToggle} type="button" aria-expanded={!collapsed}>
        <span className="kanban-column-dot" style={{ background: cfg.color }} />
        <span className="kanban-column-title">{cfg.label}</span>
        <span className="kanban-column-count">{tickets.length}</span>
        <ChevronDown size={14} className={`kanban-column-chevron${collapsed ? ' kanban-column-chevron--collapsed' : ''}`} />
      </button>
      {!collapsed && (
        <div className="kanban-column-body" role="list" aria-label={`${cfg.label} column`}>
          {tickets.length === 0 ? (
            <p className="kanban-empty">No tickets</p>
          ) : (
            tickets.map(t => (
              <div
                key={t.id}
                role="listitem"
                draggable={canMove}
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
                  lifted={liftedTicketId === t.id}
                  onKeyboardLift={onKeyboardLift}
                />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── Main ────────────────────────────────────────────────────────────────────

export function TicketKanbanBoard({ tickets, viewerIsIt, onSelect, onStatusChange, userMap }: KanbanProps) {
  const [collapsedCols, setCollapsedCols] = useState<Set<string>>(new Set())
  const [, startTransition] = useTransition()
  const [liveMessage, setLiveMessage] = useState('')

  // Keyboard DnD state
  const [liftedId, setLiftedId] = useState<string | null>(null)
  const [keyboardColIdx, setKeyboardColIdx] = useState(0)

  // Optimistic reducer — applies pending move on top of server state.
  const [optimisticTickets, applyOptimistic] = useOptimistic<Ticket[], OptimisticMove>(
    tickets,
    (state, move) => state.map(t => (t.id === move.ticket_id ? { ...t, status: move.status } : t))
  )

  const columnTickets = useMemo(() => {
    const map: Record<string, Ticket[]> = {}
    for (const s of COLUMN_ORDER) map[s] = []
    for (const t of optimisticTickets) {
      const s = (t.status || 'open') as string
      if (map[s]) map[s].push(t)
      else if (map.open) map.open.push(t)
    }
    return map
  }, [optimisticTickets])

  const toggleCol = useCallback((s: string) => {
    setCollapsedCols(prev => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s); else next.add(s)
      return next
    })
  }, [])

  const moveTicket = useCallback(async (ticketId: string, newStatus: TicketStatus) => {
    const current = tickets.find(t => t.id === ticketId)
    if (!current || current.status === newStatus) return
    setLiveMessage(`Moving ${ticketId} to ${STATUS_CONFIG[newStatus].label}.`)
    startTransition(() => {
      applyOptimistic({ ticket_id: ticketId, status: newStatus })
    })
    try {
      const ok = await Promise.resolve(onStatusChange(ticketId, newStatus))
      if (ok === false) {
        setLiveMessage(`Move rejected. ${ticketId} returned to ${STATUS_CONFIG[current.status as TicketStatus].label}.`)
      } else {
        setLiveMessage(`${ticketId} now ${STATUS_CONFIG[newStatus].label}.`)
      }
    } catch {
      setLiveMessage(`Move failed. ${ticketId} returned to ${STATUS_CONFIG[current.status as TicketStatus].label}.`)
    }
  }, [tickets, applyOptimistic, onStatusChange])

  const handleKeyboardLift = useCallback((id: string) => {
    if (!viewerIsIt) return
    const t = tickets.find(x => x.id === id)
    if (!t) return
    if (liftedId === id) {
      setLiftedId(null)
      setLiveMessage('Cancelled.')
      return
    }
    setLiftedId(id)
    setKeyboardColIdx(COLUMN_ORDER.indexOf((t.status || 'open') as TicketStatus))
    setLiveMessage(`Picked up ${id}. Use left or right arrows to choose a column, Enter to drop, Escape to cancel.`)
  }, [viewerIsIt, tickets, liftedId])

  // Global keyboard handler while lifted
  useEffect(() => {
    if (!liftedId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setLiftedId(null)
        setLiveMessage('Cancelled.')
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setKeyboardColIdx(i => {
          const ni = Math.max(0, i - 1)
          setLiveMessage(`Target: ${STATUS_CONFIG[COLUMN_ORDER[ni]].label}.`)
          return ni
        })
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        setKeyboardColIdx(i => {
          const ni = Math.min(COLUMN_ORDER.length - 1, i + 1)
          setLiveMessage(`Target: ${STATUS_CONFIG[COLUMN_ORDER[ni]].label}.`)
          return ni
        })
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const target = COLUMN_ORDER[keyboardColIdx]
        const lifted = liftedId
        setLiftedId(null)
        if (lifted && target) void moveTicket(lifted, target)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [liftedId, keyboardColIdx, moveTicket])

  return (
    <>
      <div className="kanban-board" aria-label="Ticket Kanban board" role="region">
        {COLUMN_ORDER.map((status, idx) => (
          <KanbanColumn
            key={status}
            status={status}
            tickets={columnTickets[status] || []}
            userMap={userMap}
            onSelect={onSelect}
            onDrop={moveTicket}
            canMove={viewerIsIt}
            collapsed={collapsedCols.has(status)}
            onToggle={() => toggleCol(status)}
            liftedTicketId={liftedId}
            onKeyboardLift={handleKeyboardLift}
            isKeyboardTarget={liftedId !== null && idx === keyboardColIdx}
          />
        ))}
      </div>
      <div role="status" aria-live="polite" className="sr-only">{liveMessage}</div>
    </>
  )
}
