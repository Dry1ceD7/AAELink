'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, ChevronUp, Clock, Filter, Link2, Lock, Mail, MessageSquare, Plus, RefreshCw, Search, Tag, User, X, Zap } from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'

export interface Ticket {
  id: string
  title: string
  description: string
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
  priority: 'low' | 'medium' | 'urgent' | 'critical'
  createdAt: number
  updatedAt?: number
  createdBy?: string
  assigneeId?: string
  tags?: string[]
  sla_breach_at?: number
  first_response_at?: number
  departmentCode?: string
  departmentName?: string
  /** Present on API payloads when cross-checking workspace scope. */
  workspace_id?: string
}

type TicketMessage = {
  id: string
  userId: string
  body: string
  createdAt: number
  /** 'reply' = normal, 'internal' = IT-only note, 'activity' = system event */
  kind?: 'reply' | 'internal' | 'activity'
}

type URow = { id: string; username: string; first_name: string; last_name: string; nickname: string }

const REPLY_DRAFT_PREFIX = 'aaelink-ticket-reply-draft'

/** Quick-reply templates for IT staff (inspired by Zendesk macros). */
const CANNED_RESPONSES = [
  { label: 'Acknowledge', body: 'Thank you for reporting this. We are looking into it and will update you shortly.' },
  { label: 'Need more info', body: 'Could you provide more details about the issue? Screenshots, error messages, or steps to reproduce would help us investigate faster.' },
  { label: 'Resolved', body: 'This issue has been resolved. Please re-open this ticket if the problem returns.' },
  { label: 'Escalated', body: 'This ticket has been escalated to the engineering team for further investigation. We will keep you updated.' },
]

function displayU(u: URow) {
  const full = `${u.first_name || ''} ${u.last_name || ''}`.trim()
  if (full) return full
  if (u.nickname) return u.nickname
  return u.username
}

function slaLabel(ticket: Ticket): { text: string; className: string } | null {
  if (!ticket.sla_breach_at) return null
  const now = Date.now()
  if (ticket.status === 'resolved' || ticket.status === 'closed') {
    const met = ticket.first_response_at ? ticket.first_response_at <= ticket.sla_breach_at : true
    return met
      ? { text: 'SLA met', className: 'ticket-sla ticket-sla--met' }
      : { text: 'SLA breached', className: 'ticket-sla ticket-sla--breached' }
  }
  const remaining = ticket.sla_breach_at - now
  if (remaining <= 0) return { text: 'SLA breached', className: 'ticket-sla ticket-sla--breached' }
  const hrs = Math.floor(remaining / 3600000)
  const mins = Math.floor((remaining % 3600000) / 60000)
  if (hrs < 1) return { text: `SLA ${mins}m`, className: 'ticket-sla ticket-sla--warn' }
  return { text: `SLA ${hrs}h ${mins}m`, className: 'ticket-sla ticket-sla--ok' }
}

async function messageFromFailedResponse(res: Response, fallback: string): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string }
    const code = j.error
    if (code === 'body_required') return 'Message cannot be empty.'
    if (code === 'title_required') return 'Subject is required.'
    if (code === 'forbidden') return 'You do not have permission for that action.'
    if (code === 'no_updates') return 'Nothing to update.'
    if (code === 'invalid_status') return 'That status is not valid.'
    if (code === 'invalid_priority') return 'That priority is not valid.'
  } catch {
    /* ignore */
  }
  return fallback
}

export function TicketsPanel({
  workspaceId,
  onTicketOpen,
  onBlockingOverlayChange
}: {
  workspaceId: string
  /** Called when the user opens a ticket (list click, deep link, or new ticket). Used to clear related in-app alerts. */
  onTicketOpen?: (ticketId: string) => void
  /** True while New request compose or its discard confirmation is active (home shell uses this for `inert` + scroll lock). */
  onBlockingOverlayChange?: (blocking: boolean) => void
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [viewerIsIt, setViewerIsIt] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [configError, setConfigError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailMessages, setDetailMessages] = useState<TicketMessage[]>([])
  const [replyBody, setReplyBody] = useState('')
  const [userMap, setUserMap] = useState<Record<string, URow>>({})
  const [composeOpen, setComposeOpen] = useState(false)
  const [composeMinimized, setComposeMinimized] = useState(false)
  const [listBusy, setListBusy] = useState(false)
  const [replyBusy, setReplyBusy] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [newPriority, setNewPriority] = useState<Ticket['priority']>('medium')
  const [newCategory, setNewCategory] = useState<string>('general')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | Ticket['status']>('all')
  const [actionError, setActionError] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)
  const [detailBusy, setDetailBusy] = useState(false)
  const [threadRefreshBusy, setThreadRefreshBusy] = useState(false)
  const [softSyncDepth, setSoftSyncDepth] = useState(0)
  const [threadLoadError, setThreadLoadError] = useState('')
  const [composeDiscardConfirmOpen, setComposeDiscardConfirmOpen] = useState(false)

  const workspaceIdRef = useRef(workspaceId)
  const detailBusyRef = useRef(false)
  const panelInViewRef = useRef(true)
  const panelRootRef = useRef<HTMLDivElement>(null)
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null)
  const composeTitleInputRef = useRef<HTMLInputElement>(null)
  const composeDiscardKeepRef = useRef<HTMLButtonElement>(null)
  const composePopPanelRef = useRef<HTMLDivElement>(null)
  const discardConfirmPanelRef = useRef<HTMLDivElement>(null)
  const priorFocusBeforeComposeRef = useRef<HTMLElement | null>(null)
  const loadRunningRef = useRef(false)
  const loadAgainRef = useRef(false)
  const linkCopyTimerRef = useRef<number | null>(null)
  const ticketsRef = useRef<Ticket[]>([])
  const detailSeqRef = useRef(0)
  const selectedIdRef = useRef<string | null>(null)
  workspaceIdRef.current = workspaceId
  ticketsRef.current = tickets
  selectedIdRef.current = selectedId
  detailBusyRef.current = detailBusy

  const ticketFromUrl = (searchParams.get('ticket') || '').trim()

  const clearTicketQueryParam = useCallback(() => {
    const p = new URLSearchParams(searchParams.toString())
    if (!p.has('ticket')) return
    p.delete('ticket')
    const qs = p.toString()
    router.replace(qs ? `/home?${qs}` : '/home')
  }, [router, searchParams])

  useEffect(() => {
    if (!ticketFromUrl || !hydrated) return

    const list = ticketsRef.current
    if (list.some(t => t.id === ticketFromUrl)) {
      setSelectedId(ticketFromUrl)
      onTicketOpen?.(ticketFromUrl)
      clearTicketQueryParam()
      return
    }

    const ac = new AbortController()
    void (async () => {
      try {
        const res = await apiFetch(`/api/tickets/${encodeURIComponent(ticketFromUrl)}`, { signal: ac.signal })
        if (!res.ok) {
          setActionError(
            res.status === 403 || res.status === 404
              ? 'That link does not open a ticket you can access in this workspace.'
              : 'Could not open the linked ticket.'
          )
          clearTicketQueryParam()
          return
        }
        const data = (await res.json()) as { ticket: Ticket }
        const tk = data.ticket
        if (!tk?.id) {
          setActionError('Could not open the linked ticket.')
          clearTicketQueryParam()
          return
        }
        const tws = String(tk.workspace_id || '')
        if (tws && tws !== workspaceIdRef.current) {
          setActionError('That ticket is not in the workspace you have open. Switch workspace and try again.')
          clearTicketQueryParam()
          return
        }
        setSearchQuery('')
        setStatusFilter('all')
        setTickets(prev => (prev.some(t => t.id === tk.id) ? prev : [tk, ...prev]))
        setSelectedId(tk.id)
        onTicketOpen?.(tk.id)
        clearTicketQueryParam()
      } catch {
        if (ac.signal.aborted) return
        setActionError('Could not open the linked ticket.')
        clearTicketQueryParam()
      }
    })()

    return () => ac.abort()
  }, [ticketFromUrl, hydrated, onTicketOpen, clearTicketQueryParam])

  useEffect(() => {
    return () => {
      if (linkCopyTimerRef.current != null) window.clearTimeout(linkCopyTimerRef.current)
    }
  }, [])

  const load = useCallback(async () => {
    if (!workspaceIdRef.current) return
    if (loadRunningRef.current) {
      loadAgainRef.current = true
      return
    }
    loadRunningRef.current = true
    setListBusy(true)
    setLoadError('')
    try {
      do {
        loadAgainRef.current = false
        const ws = workspaceIdRef.current
        if (!ws) break
        const res = await apiFetch(`/api/tickets?workspace_id=${encodeURIComponent(ws)}`)
        if (!workspaceIdRef.current) break
        if (res.status === 401) {
          window.location.href = '/login'
          break
        }
        if (res.status === 503) {
          setConfigError('Tickets are temporarily unavailable. Try again later or contact IT.')
          setTickets([])
          break
        }
        if (res.status === 403) {
          setLoadError('You are not a member of this workspace.')
          setTickets([])
          break
        }
        if (!res.ok) {
          setLoadError('Could not load tickets.')
          break
        }
        const data = await res.json()
        setTickets(data.tickets ?? [])
        setViewerIsIt(Boolean(data.meta?.viewer_is_it))
        setConfigError('')
      } while (loadAgainRef.current)
    } finally {
      loadRunningRef.current = false
      setListBusy(false)
      setHydrated(true)
    }
  }, [])

  const resolveUsers = useCallback(async (ids: string[]) => {
    const uniq = [...new Set(ids.filter(Boolean))]
    if (uniq.length === 0) return
    const res = await apiFetch('/api/collab/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: uniq })
    })
    if (!res.ok) return
    const data = (await res.json()) as { users?: URow[] }
    const users = data.users ?? []
    setUserMap(prev => {
      const next = { ...prev }
      for (const u of users) next[u.id] = u
      return next
    })
  }, [])

  const loadDetail = useCallback(
    async (id: string, opts?: { soft?: boolean }) => {
      const soft = Boolean(opts?.soft)
      const seq = ++detailSeqRef.current
      if (soft) setSoftSyncDepth(d => d + 1)
      if (!soft) {
        setDetailBusy(true)
        setThreadLoadError('')
      }
      try {
        const res = await apiFetch(`/api/tickets/${encodeURIComponent(id)}`)
        if (seq !== detailSeqRef.current) return
        if (res.status === 401) {
          window.location.href = '/login'
          return
        }
        if (!res.ok) {
          setDetailMessages([])
          if (res.status === 404 || res.status === 403) {
            setActionError(
              res.status === 404
                ? 'That ticket no longer exists or was removed.'
                : 'You cannot open that ticket.'
            )
            setSelectedId(cur => (cur === id ? null : cur))
            setTickets(prev => prev.filter(t => t.id !== id))
          } else if (!soft && seq === detailSeqRef.current) {
            setThreadLoadError(await messageFromFailedResponse(res, 'Could not load the thread.'))
          }
          return
        }
        let data: {
          ticket: Ticket & { departmentName?: string; departmentCode?: string }
          messages: TicketMessage[]
          meta?: { viewer_is_it: boolean }
        }
        try {
          data = (await res.json()) as typeof data
        } catch {
          if (seq !== detailSeqRef.current) return
          if (!soft) setThreadLoadError('Could not read the server response.')
          return
        }
        if (seq !== detailSeqRef.current) return
        setThreadLoadError('')
        if (data.meta) setViewerIsIt(data.meta.viewer_is_it)
        const dt = data.ticket
        if (dt?.id) {
          setTickets(prev => {
            const idx = prev.findIndex(x => x.id === dt.id)
            if (idx < 0) return prev
            const ex = prev[idx]
            const merged: Ticket = {
              ...ex,
              title: dt.title,
              description: dt.description,
              status: dt.status,
              priority: dt.priority,
              updatedAt: dt.updatedAt ?? ex.updatedAt,
              departmentName: dt.departmentName ?? ex.departmentName,
              departmentCode: dt.departmentCode ?? ex.departmentCode
            }
            return [...prev.slice(0, idx), merged, ...prev.slice(idx + 1)]
          })
        }
        setDetailMessages(data.messages ?? [])
        const uids = [data.ticket?.createdBy, ...((data.messages ?? []).map(m => m.userId))].filter(
          (x): x is string => Boolean(x)
        )
        void resolveUsers([...new Set(uids)])
      } finally {
        if (soft) setSoftSyncDepth(d => Math.max(0, d - 1))
        if (!soft && seq === detailSeqRef.current) setDetailBusy(false)
      }
    },
    [resolveUsers]
  )

  const refreshThread = useCallback(async () => {
    const id = selectedIdRef.current
    if (!id) return
    setThreadRefreshBusy(true)
    try {
      await loadDetail(id, { soft: true })
      await load()
    } finally {
      setThreadRefreshBusy(false)
    }
  }, [load, loadDetail])

  useEffect(() => {
    setHydrated(false)
    setTickets([])
    setSelectedId(null)
    setLoadError('')
    setConfigError('')
    setSearchQuery('')
    setStatusFilter('all')
    setSoftSyncDepth(0)
    setThreadLoadError('')
    setComposeDiscardConfirmOpen(false)
  }, [workspaceId])

  useEffect(() => {
    setThreadLoadError('')
  }, [selectedId])

  useEffect(() => {
    const el = panelRootRef.current
    if (!el) return
    const io = new IntersectionObserver(
      entries => {
        const e = entries[0]
        panelInViewRef.current = Boolean(e?.isIntersecting)
      },
      { threshold: [0, 0.01, 0.05] }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [workspaceId, hydrated])

  useEffect(() => {
    if (!workspaceId) return
    void load()
  }, [workspaceId, load])

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId)
    else {
      setDetailMessages([])
      setReplyBody('')
    }
  }, [selectedId, loadDetail])

  useLayoutEffect(() => {
    if (!selectedId || !workspaceId) return
    try {
      const raw = sessionStorage.getItem(`${REPLY_DRAFT_PREFIX}:${workspaceId}:${selectedId}`)
      setReplyBody(typeof raw === 'string' ? raw : '')
    } catch {
      setReplyBody('')
    }
  }, [selectedId, workspaceId])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (!workspaceIdRef.current || !hydrated) return
      const id = selectedIdRef.current
      void load()
      if (id && !detailBusyRef.current && panelInViewRef.current) void loadDetail(id, { soft: true })
    }
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) onVisible()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [hydrated, load, loadDetail])

  useEffect(() => {
    if (!workspaceId || !hydrated) return
    const POLL_MS = 75_000
    const tick = () => {
      if (document.visibilityState !== 'visible') return
      if (!workspaceIdRef.current) return
      if (!panelInViewRef.current) return
      void load()
      const id = selectedIdRef.current
      if (id && !detailBusyRef.current) void loadDetail(id, { soft: true })
    }
    const t = window.setInterval(tick, POLL_MS)
    return () => window.clearInterval(t)
  }, [workspaceId, hydrated, load, loadDetail])

  useEffect(() => {
    if (!selectedId || !workspaceId) return
    const t = window.setTimeout(() => {
      try {
        const key = `${REPLY_DRAFT_PREFIX}:${workspaceId}:${selectedId}`
        if (!replyBody.trim()) sessionStorage.removeItem(key)
        else sessionStorage.setItem(key, replyBody)
      } catch {
        /* ignore */
      }
    }, 450)
    return () => window.clearTimeout(t)
  }, [replyBody, selectedId, workspaceId])

  useEffect(() => {
    const dirtyReply = Boolean(selectedId && replyBody.trim())
    const dirtyCompose = Boolean(composeOpen && (title.trim() || description.trim()))
    if (!dirtyReply && !dirtyCompose) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [selectedId, replyBody, composeOpen, title, description])

  useEffect(() => {
    if (!selectedId || detailBusy || replyBusy) return
    if (composeOpen && !composeMinimized) return
    const id = window.requestAnimationFrame(() => {
      replyTextareaRef.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(id)
  }, [selectedId, detailBusy, replyBusy, composeOpen, composeMinimized])

  useEffect(() => {
    if (!composeOpen || composeMinimized) return
    const id = window.requestAnimationFrame(() => {
      composeTitleInputRef.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(id)
  }, [composeOpen, composeMinimized])

  const closeCompose = useCallback(() => {
    setComposeOpen(false)
    setComposeMinimized(false)
  }, [])

  const discardCompose = useCallback(() => {
    setComposeDiscardConfirmOpen(false)
    setTitle('')
    setDescription('')
    setNewPriority('medium')
    setComposeOpen(false)
    setComposeMinimized(false)
  }, [])

  const cancelDiscardCompose = useCallback(() => {
    setComposeDiscardConfirmOpen(false)
  }, [])

  const requestDiscardCompose = useCallback(() => {
    if (title.trim() || description.trim()) {
      setComposeDiscardConfirmOpen(true)
      return
    }
    discardCompose()
  }, [title, description, discardCompose])

  useLayoutEffect(() => {
    if (!composeDiscardConfirmOpen) return
    const id = window.requestAnimationFrame(() => {
      composeDiscardKeepRef.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(id)
  }, [composeDiscardConfirmOpen])

  useLayoutEffect(() => {
    if (composeOpen || composeDiscardConfirmOpen) return
    const el = priorFocusBeforeComposeRef.current
    priorFocusBeforeComposeRef.current = null
    if (!el || !document.contains(el)) return
    try {
      el.focus({ preventScroll: true })
    } catch {
      /* ignore */
    }
  }, [composeOpen, composeDiscardConfirmOpen])

  useEffect(() => {
    const blocking = Boolean(composeOpen || composeDiscardConfirmOpen)
    onBlockingOverlayChange?.(blocking)
    return () => onBlockingOverlayChange?.(false)
  }, [composeOpen, composeDiscardConfirmOpen, onBlockingOverlayChange])

  useEffect(() => {
    const panel = composeDiscardConfirmOpen
      ? discardConfirmPanelRef.current
      : composeOpen
        ? composePopPanelRef.current
        : null
    if (!panel) return

    const focusables = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter(el => el.offsetParent !== null || el === document.activeElement)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const active = document.activeElement
      if (!active || !panel.contains(active)) return
      const nodes = focusables()
      if (nodes.length === 0) return
      if (nodes.length === 1) {
        e.preventDefault()
        nodes[0].focus()
        return
      }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (e.shiftKey) {
        if (active === first) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [composeDiscardConfirmOpen, composeOpen])

  const copyTicketLink = useCallback(async () => {
    if (!selectedId || !workspaceId) return
    const url = `${window.location.origin}/home?team=${encodeURIComponent(workspaceId)}&module=tickets&ticket=${encodeURIComponent(selectedId)}`
    try {
      await navigator.clipboard.writeText(url)
      setActionError('')
      setLinkCopied(true)
      if (linkCopyTimerRef.current != null) window.clearTimeout(linkCopyTimerRef.current)
      linkCopyTimerRef.current = window.setTimeout(() => setLinkCopied(false), 2400)
    } catch {
      setLinkCopied(false)
      setActionError('Could not copy the link. Copy the address from the browser bar instead.')
    }
  }, [selectedId, workspaceId])

  const visibleTickets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return tickets.filter(t => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false
      if (!q) return true
      return (
        t.title.toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q) ||
        (t.departmentName || '').toLowerCase().includes(q)
      )
    })
  }, [tickets, statusFilter, searchQuery])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (composeDiscardConfirmOpen) {
        e.preventDefault()
        e.stopPropagation()
        cancelDiscardCompose()
        return
      }
      if (composeOpen) {
        e.preventDefault()
        e.stopPropagation()
        requestDiscardCompose()
        return
      }
      if (selectedId) {
        e.preventDefault()
        e.stopPropagation()
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [composeOpen, composeDiscardConfirmOpen, selectedId, requestDiscardCompose, cancelDiscardCompose])

  async function createTicket() {
    if (!title.trim() || !workspaceId || createBusy) return
    setActionError('')
    setCreateBusy(true)
    const res = await apiFetch('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: workspaceId,
        title: title.trim(),
        description: description.trim(),
        priority: newPriority,
        tags: [newCategory]
      })
    })
    if (res.status === 503) {
      setConfigError('Tickets are temporarily unavailable. Try again later or contact IT.')
      setCreateBusy(false)
      return
    }
    if (!res.ok) {
      setActionError(await messageFromFailedResponse(res, 'Could not send the request.'))
      setCreateBusy(false)
      return
    }
    const data = (await res.json()) as { ticket: { id: string } }
    setComposeDiscardConfirmOpen(false)
    setTitle('')
    setDescription('')
    setNewPriority('medium')
    setNewCategory('general')
    setComposeOpen(false)
    setComposeMinimized(false)
    setCreateBusy(false)
    await load()
    if (data.ticket?.id) {
      setSelectedId(data.ticket.id)
      onTicketOpen?.(data.ticket.id)
    }
  }

  async function updateTicket(id: string, patch: Partial<Ticket>) {
    if (detailBusy) return
    if (!viewerIsIt && (patch.status || patch.priority)) return
    setActionError('')
    const res = await apiFetch(`/api/tickets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    })
    if (!res.ok) {
      setActionError(await messageFromFailedResponse(res, 'Could not update the ticket.'))
      return
    }
    const data = (await res.json()) as { ticket: Ticket }
    const next = data.ticket
    setTickets(current =>
      current.map(t => (t.id === id ? { ...t, ...next, createdBy: next.createdBy ?? t.createdBy } : t))
    )
    if (selectedId === id) void loadDetail(id, { soft: true })
  }

  async function sendReply() {
    if (!selectedId || !replyBody.trim() || replyBusy || detailBusy) return
    setActionError('')
    setReplyBusy(true)
    const res = await apiFetch(`/api/tickets/${encodeURIComponent(selectedId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: replyBody.trim() })
    })
    setReplyBusy(false)
    if (!res.ok) {
      setActionError(await messageFromFailedResponse(res, 'Could not send the reply.'))
      return
    }
    try {
      const key = `${REPLY_DRAFT_PREFIX}:${workspaceId}:${selectedId}`
      sessionStorage.removeItem(key)
    } catch {
      /* ignore */
    }
    setReplyBody('')
    await loadDetail(selectedId, { soft: true })
    await load()
  }

  if (!workspaceId) {
    return <p className="doc-muted">Choose a workspace to manage tickets.</p>
  }

  const selected = hydrated ? tickets.find(t => t.id === selectedId) : undefined

  function statusLabel(s: Ticket['status']) {
    if (s === 'in_progress') return 'In progress'
    if (s === 'closed') return 'Closed'
    return s.charAt(0).toUpperCase() + s.slice(1)
  }

  function snippet(text: string, max = 72) {
    const line = (text || '').replace(/\s+/g, ' ').trim()
    if (line.length <= max) return line
    return `${line.slice(0, max)}…`
  }

  function initials(u: URow) {
    const f = (u.first_name || '').charAt(0).toUpperCase()
    const l = (u.last_name || '').charAt(0).toUpperCase()
    if (f && l) return `${f}${l}`
    return (u.username || '?').charAt(0).toUpperCase()
  }

  return (
    <div ref={panelRootRef} className="ticket-mail-root">
      {!hydrated ? (
        <p className="module-loading">Loading tickets</p>
      ) : (
        <>
          <header className="ticket-mail-toolbar">
            <div className="ticket-mail-toolbar-left">
              <Mail size={22} strokeWidth={2} className="ticket-mail-toolbar-icon" aria-hidden="true" />
              <div>
                <h1 className="ticket-mail-inbox-title">Tickets</h1>
                <p className="ticket-mail-toolbar-sub">
                  {visibleTickets.length !== tickets.length
                    ? `${visibleTickets.length} of ${tickets.length} in this workspace`
                    : `${tickets.length} in this workspace`}
                </p>
              </div>
            </div>
            <div className="ticket-mail-toolbar-actions">
              <button
                type="button"
                className="ticket-mail-icon-btn"
                title="Refresh"
                aria-label="Refresh list"
                disabled={listBusy}
                onClick={() => void load()}
              >
                <RefreshCw size={18} strokeWidth={2} className={listBusy ? 'spin' : undefined} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="ticket-mail-new-btn"
                onClick={() => {
                  setActionError('')
                  const a = document.activeElement
                  priorFocusBeforeComposeRef.current = a instanceof HTMLElement ? a : null
                  setComposeOpen(true)
                  setComposeMinimized(false)
                }}
              >
                <Plus size={18} strokeWidth={2.25} aria-hidden="true" />
                New request
              </button>
            </div>
          </header>

          <p className="ticket-mail-lead">
            Requests work like mail: pick one in the list, read the thread, reply below. Use New request to open a compose window. Press Escape to clear selection or close compose.
          </p>

          {configError ? <p className="form-error">{configError}</p> : null}
          {loadError ? (
            <div className="ticket-mail-banner ticket-mail-banner--error ticket-mail-list-error" role="alert">
              <span>{loadError}</span>
              <div className="ticket-mail-thread-error-actions">
                <button
                  type="button"
                  className="slack-button"
                  style={{ padding: '4px 12px', fontSize: 12 }}
                  disabled={listBusy}
                  onClick={() => {
                    setLoadError('')
                    void load()
                  }}
                >
                  Retry
                </button>
                <button type="button" className="ticket-mail-banner-dismiss" onClick={() => setLoadError('')} aria-label="Dismiss">
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}
          {actionError ? (
            <div className="ticket-mail-banner ticket-mail-banner--error" role="alert">
              <span>{actionError}</span>
              <button type="button" className="ticket-mail-banner-dismiss" onClick={() => setActionError('')} aria-label="Dismiss">
                Dismiss
              </button>
            </div>
          ) : null}

          <div className="ticket-mail-filter-row" role="search">
            <label className="ticket-mail-filter-search">
              <Search size={16} strokeWidth={2} aria-hidden="true" />
              <input
                type="search"
                className="slack-input ticket-mail-filter-input"
                placeholder="Search subject or message"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                aria-label="Search tickets"
              />
            </label>
            <label className="ticket-mail-filter-status">
              <Filter size={16} strokeWidth={2} aria-hidden="true" />
              <select
                className="slack-input ticket-mail-filter-select"
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
                aria-label="Filter by status"
              >
                <option value="all">All statuses</option>
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>
            </label>
          </div>

          <div className="ticket-mail-columns">
            <div className="ticket-mail-list" role="list">
              {tickets.length === 0 ? (
                <p className="doc-muted" style={{ padding: 16 }}>
                  No requests yet. Click New request to open the compose window.
                </p>
              ) : visibleTickets.length === 0 ? (
                <p className="doc-muted" style={{ padding: 16 }}>
                  No requests match the current filters. Clear search or set status to All.
                </p>
              ) : (
                visibleTickets.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    role="listitem"
                    className={`ticket-mail-row${selectedId === t.id ? ' ticket-mail-row--active' : ''}`}
                    onClick={() => {
                      setSelectedId(t.id)
                      onTicketOpen?.(t.id)
                    }}
                  >
                    <div className="ticket-mail-row-top">
                      <span className="ticket-mail-row-subj">{t.title}</span>
                      <div className="ticket-mail-row-badges">
                        {(() => { const s = slaLabel(t); return s ? <span className={s.className}>{s.text}</span> : null })()}
                        <span className={`ticket-mail-pill ticket-mail-pill--${t.status}`}>{statusLabel(t.status)}</span>
                      </div>
                    </div>
                    <div className="ticket-mail-row-snippet">{snippet(t.description)}</div>
                    {t.tags && t.tags.length > 0 ? (
                      <div className="ticket-mail-row-tags">
                        <Tag size={12} strokeWidth={2} aria-hidden />
                        {t.tags.map(tag => <span key={tag} className="ticket-tag">{tag}</span>)}
                      </div>
                    ) : null}
                    <div className="ticket-mail-row-meta">
                      <span className={`ticket-mail-priority ticket-mail-priority--${t.priority}`}>{t.priority}</span>
                      <span>{new Date(t.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                      {t.departmentName ? <span>· {t.departmentName}</span> : null}
                      {t.assigneeId && userMap[t.assigneeId] ? (
                        <span className="ticket-mail-row-assignee">
                          <span className="ticket-avatar-sm" title={displayU(userMap[t.assigneeId])}>{initials(userMap[t.assigneeId])}</span>
                        </span>
                      ) : null}
                    </div>
                    {t.updatedAt != null && t.updatedAt - t.createdAt > 2000 ? (
                      <div className="ticket-mail-row-updated doc-muted">
                        Updated {new Date(t.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                      </div>
                    ) : null}
                  </button>
                ))
              )}
            </div>

            <div className="ticket-mail-detail" role="region" aria-label="Ticket">
              {selected ? (
                <>
                  <div className="ticket-mail-detail-header">
                    <h2 className="ticket-mail-detail-title">{selected.title}</h2>
                    <div className="ticket-mail-detail-id-row">
                      <span className="ticket-mail-detail-id">{selected.id}</span>
                      <button
                        type="button"
                        className="ticket-mail-link-btn"
                        title="Reload thread and list"
                        aria-label="Refresh thread"
                        disabled={threadRefreshBusy || detailBusy}
                        onClick={() => void refreshThread()}
                      >
                        <RefreshCw size={16} strokeWidth={2} className={threadRefreshBusy ? 'spin' : undefined} aria-hidden="true" />
                        Refresh
                      </button>
                      <button type="button" className="ticket-mail-link-btn" onClick={() => void copyTicketLink()}>
                        <Link2 size={16} strokeWidth={2} aria-hidden="true" />
                        Copy link
                      </button>
                      {linkCopied ? <span className="ticket-mail-copy-done">Copied</span> : null}
                    </div>
                    {selected.departmentName ? (
                      <p className="doc-muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
                        Routed to {selected.departmentName}
                      </p>
                    ) : null}
                    {/* ── SLA + Tags + Assignee info bar ─── */}
                    <div className="ticket-detail-info-bar">
                      {(() => { const s = slaLabel(selected); return s ? <span className={s.className}><Clock size={13} strokeWidth={2} aria-hidden style={{ marginRight: 4, verticalAlign: -2 }} />{s.text}</span> : null })()}
                      {selected.tags && selected.tags.length > 0 ? (
                        <div className="ticket-detail-tags">
                          <Tag size={13} strokeWidth={2} aria-hidden />
                          {selected.tags.map(tag => <span key={tag} className="ticket-tag">{tag}</span>)}
                        </div>
                      ) : null}
                      {selected.assigneeId && userMap[selected.assigneeId] ? (
                        <div className="ticket-detail-assignee">
                          <User size={13} strokeWidth={2} aria-hidden />
                          <span>Assigned to <strong>{displayU(userMap[selected.assigneeId])}</strong></span>
                        </div>
                      ) : null}
                    </div>

                    {viewerIsIt ? (
                      <div className="ticket-controls" style={{ marginTop: 10 }}>
                        <label>
                          Status
                          <select
                            value={selected.status}
                            disabled={detailBusy}
                            onChange={e => void updateTicket(selected.id, { status: e.target.value as Ticket['status'] })}
                          >
                            <option value="open">Open</option>
                            <option value="in_progress">In progress</option>
                            <option value="resolved">Resolved</option>
                            <option value="closed">Closed</option>
                          </select>
                        </label>
                        <label>
                          Priority
                          <select
                            value={selected.priority}
                            disabled={detailBusy}
                            onChange={e => void updateTicket(selected.id, { priority: e.target.value as Ticket['priority'] })}
                          >
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="urgent">Urgent</option>
                            <option value="critical">Critical</option>
                          </select>
                        </label>
                      </div>
                    ) : (
                      <p className="doc-muted" style={{ margin: '6px 0 0' }}>
                        {statusLabel(selected.status)} · {selected.priority}
                      </p>
                    )}
                  </div>

                  {threadLoadError ? (
                    <div className="ticket-mail-banner ticket-mail-banner--error ticket-mail-thread-error" role="alert">
                      <span>{threadLoadError}</span>
                      <div className="ticket-mail-thread-error-actions">
                        <button
                          type="button"
                          className="slack-button"
                          style={{ padding: '4px 12px', fontSize: 12 }}
                          onClick={() => {
                            setThreadLoadError('')
                            void loadDetail(selected.id)
                          }}
                        >
                          Retry
                        </button>
                        <button
                          type="button"
                          className="ticket-mail-banner-dismiss"
                          onClick={() => setThreadLoadError('')}
                          aria-label="Dismiss"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {detailBusy ? (
                    <p className="ticket-mail-thread-loading doc-muted" role="status" aria-live="polite">
                      Loading thread…
                    </p>
                  ) : softSyncDepth > 0 ? (
                    <p className="ticket-mail-thread-loading doc-muted" role="status" aria-live="polite">
                      Updating thread…
                    </p>
                  ) : null}

                  <div className="ticket-mail-thread" role="log" aria-busy={detailBusy || softSyncDepth > 0}>
                    {selected.description ? (
                      <article className="ticket-mail-msg">
                        <div className="ticket-mail-msg-head">
                          <strong>{selected.createdBy && userMap[selected.createdBy] ? displayU(userMap[selected.createdBy]) : 'Request'}</strong>
                          <time>{new Date(selected.createdAt).toLocaleString()}</time>
                        </div>
                        <p className="ticket-mail-msg-body">{selected.description}</p>
                      </article>
                    ) : null}
                    {detailMessages.map(m => {
                      if (m.kind === 'activity') {
                        return (
                          <div key={m.id} className="ticket-activity-entry">
                            <Zap size={13} strokeWidth={2} aria-hidden />
                            <span>{m.body}</span>
                            <time>{new Date(m.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</time>
                          </div>
                        )
                      }
                      return (
                        <article className={`ticket-mail-msg${m.kind === 'internal' ? ' ticket-mail-msg--internal' : ''}`} key={m.id}>
                          <div className="ticket-mail-msg-head">
                            <strong>
                              {userMap[m.userId] ? displayU(userMap[m.userId]) : (m.userId || '?').slice(0, 8)}
                            </strong>
                            {m.kind === 'internal' ? (
                              <span className="ticket-internal-badge"><Lock size={11} strokeWidth={2} aria-hidden /> Internal</span>
                            ) : null}
                            <time>{new Date(m.createdAt).toLocaleString()}</time>
                          </div>
                          <p className="ticket-mail-msg-body">{m.body}</p>
                        </article>
                      )
                    })}
                  </div>

                  <div className="ticket-mail-reply" aria-label="Reply">
                    {viewerIsIt ? (
                      <div className="ticket-canned-row">
                        <MessageSquare size={14} strokeWidth={2} aria-hidden />
                        <span className="ticket-canned-label">Quick replies:</span>
                        {CANNED_RESPONSES.map(cr => (
                          <button
                            key={cr.label}
                            type="button"
                            className="ticket-canned-btn"
                            onClick={() => setReplyBody(prev => prev ? `${prev}\n\n${cr.body}` : cr.body)}
                          >
                            {cr.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <label className="field-label" style={{ marginTop: 0 }}>
                      Reply
                      <textarea
                        ref={replyTextareaRef}
                        className="slack-textarea"
                        rows={3}
                        value={replyBody}
                        disabled={replyBusy || detailBusy}
                        onChange={e => setReplyBody(e.target.value)}
                        placeholder="Add an update. Enter sends, Shift+Enter for newline."
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            void sendReply()
                          }
                        }}
                      />
                    </label>
                    <div className="ticket-form-actions">
                      <button
                        type="button"
                        className="slack-button"
                        onClick={() => void sendReply()}
                        disabled={replyBusy || detailBusy || !replyBody.trim()}
                      >
                        {replyBusy ? 'Sending…' : 'Send reply'}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <p className="doc-muted" style={{ padding: 24, textAlign: 'center' }}>
                  Select a request to read the thread, or open New request to compose.
                </p>
              )}
            </div>
          </div>

          {composeDiscardConfirmOpen && typeof document !== 'undefined'
            ? createPortal(
                <div className="mm-modal-overlay" role="presentation" onClick={cancelDiscardCompose}>
                  <div
                    ref={discardConfirmPanelRef}
                    className="mm-modal"
                    role="alertdialog"
                    aria-modal="true"
                    aria-labelledby="ticket-compose-discard-title"
                    onClick={e => e.stopPropagation()}
                  >
                    <h2 id="ticket-compose-discard-title">Discard this draft?</h2>
                    <p className="doc-muted" style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.45 }}>
                      You have text in this request. If you leave now, it will not be saved.
                    </p>
                    <div className="mm-modal-actions">
                      <button ref={composeDiscardKeepRef} type="button" className="ghost-button" onClick={cancelDiscardCompose}>
                        Keep editing
                      </button>
                      <button type="button" className="slack-button" onClick={discardCompose}>
                        Discard
                      </button>
                    </div>
                  </div>
                </div>,
                document.body
              )
            : null}

          {composeOpen && typeof document !== 'undefined'
            ? createPortal(
                <div
                  ref={composePopPanelRef}
                  className={`ticket-compose-pop${composeMinimized ? ' ticket-compose-pop--min' : ''}`}
                  role="dialog"
                  aria-label="New ticket"
                  aria-modal="true"
                >
                  <div className="ticket-compose-pop-head">
                    <span className="ticket-compose-pop-title">New request</span>
                    <div className="ticket-compose-pop-head-actions">
                      <button
                        type="button"
                        className="ticket-compose-pop-icon"
                        title={composeMinimized ? 'Expand' : 'Minimize'}
                        aria-label={composeMinimized ? 'Expand compose' : 'Minimize compose'}
                        onClick={() => setComposeMinimized(m => !m)}
                      >
                        {composeMinimized ? (
                          <ChevronUp size={18} strokeWidth={2} aria-hidden="true" />
                        ) : (
                          <ChevronDown size={18} strokeWidth={2} aria-hidden="true" />
                        )}
                      </button>
                      <button type="button" className="ticket-compose-pop-icon" title="Close" aria-label="Close compose" onClick={requestDiscardCompose}>
                        <X size={18} strokeWidth={2} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  {!composeMinimized ? (
                    <>
                      <div className="ticket-compose-pop-body">
                        <label className="field-label ticket-compose-field">
                          Subject
                          <input
                            ref={composeTitleInputRef}
                            className="slack-input"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            placeholder="What do you need?"
                          />
                        </label>
                        <label className="field-label ticket-compose-field">
                          Message
                          <textarea
                            className="slack-textarea ticket-compose-textarea"
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="Context, systems, urgency, who is affected."
                            rows={5}
                          />
                        </label>
                        <label className="field-label ticket-compose-field">
                          Priority
                          <select
                            className="slack-input"
                            value={newPriority}
                            onChange={e => setNewPriority(e.target.value as Ticket['priority'])}
                          >
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="urgent">Urgent</option>
                            <option value="critical">Critical</option>
                          </select>
                        </label>
                        <label className="field-label ticket-compose-field">
                          Category
                          <select
                            className="slack-input"
                            value={newCategory}
                            onChange={e => setNewCategory(e.target.value)}
                          >
                            <option value="general">General Help</option>
                            <option value="hardware">Hardware / Equipment</option>
                            <option value="software">Software / Access</option>
                            <option value="hr">HR / People Ops</option>
                            <option value="facilities">Facilities</option>
                          </select>
                        </label>
                      </div>
                      <div className="ticket-compose-pop-foot">
                        <button type="button" className="ghost-button" onClick={requestDiscardCompose} disabled={createBusy}>
                          Discard
                        </button>
                        <button
                          type="button"
                          className="slack-button"
                          onClick={() => void createTicket()}
                          disabled={createBusy || !title.trim()}
                        >
                          {createBusy ? 'Sending…' : 'Send request'}
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>,
                document.body
              )
            : null}
        </>
      )}
    </div>
  )
}
