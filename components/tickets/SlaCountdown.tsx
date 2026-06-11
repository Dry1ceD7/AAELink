'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, Timer } from 'lucide-react'
import { formatSlaRemaining, slaStatus, type TicketPriority } from '@/lib/enterprise/slaEngine'

interface SlaCountdownProps {
  /** Epoch-ms when the SLA expires */
  slaDueAt: number
  /** Ticket status — used to show "met" state when resolved/closed */
  ticketStatus?: string
  /** Compact inline badge (default) or full pill */
  variant?: 'badge' | 'pill' | 'inline'
  /** Show the icon? Default true */
  showIcon?: boolean
}

/**
 * Real-time SLA countdown that re-renders every minute while the ticket
 * is still active. Color-escalates through green → amber → red → pulsing red.
 */
export function SlaCountdown({
  slaDueAt,
  ticketStatus = 'open',
  variant = 'badge',
  showIcon = true
}: SlaCountdownProps) {
  const [now, setNow] = useState(Date.now)

  // Tick every 30 seconds while component is mounted and ticket is active
  useEffect(() => {
    if (!slaDueAt || slaDueAt <= 0) return
    if (ticketStatus === 'resolved' || ticketStatus === 'closed') return

    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [slaDueAt, ticketStatus])

  const isDone = ticketStatus === 'resolved' || ticketStatus === 'closed'
  const status = !slaDueAt || slaDueAt <= 0
    ? 'met' as const
    : isDone ? 'met' as const : slaStatus(now, slaDueAt)

  // Hook must run on every render to satisfy rules-of-hooks; the icon is only
  // referenced after the conditional return below, so memoizing here is cheap.
  const icon = useMemo(() => {
    if (!showIcon) return null
    switch (status) {
      case 'met': return <CheckCircle2 size={12} strokeWidth={2.5} aria-hidden="true" />
      case 'breached': return <AlertTriangle size={12} strokeWidth={2.5} aria-hidden="true" />
      case 'warning': return <Timer size={12} strokeWidth={2.5} aria-hidden="true" />
      default: return <Clock size={12} strokeWidth={2} aria-hidden="true" />
    }
  }, [status, showIcon])

  if (!slaDueAt || slaDueAt <= 0) return null

  const text = isDone ? 'SLA met' : formatSlaRemaining(now, slaDueAt)

  const classBase = `sla-countdown sla-countdown--${variant}`
  const classStatus = `sla-countdown--${status}`
  const pulseClass = status === 'breached' ? ' sla-countdown--pulse' : ''

  return (
    <span
      className={`${classBase} ${classStatus}${pulseClass}`}
      role="timer"
      aria-label={`SLA: ${text}`}
      title={`SLA deadline: ${new Date(slaDueAt).toLocaleString()}`}
    >
      {icon}
      <span className="sla-countdown-text">{text}</span>
    </span>
  )
}
