'use client'

import { useCallback, useEffect, useState } from 'react'
import { ModuleChrome } from '@/app/components/ModuleChrome'

interface Ticket {
  id: string
  title: string
  description: string
  status: 'open' | 'in_progress' | 'resolved'
  priority: 'low' | 'medium' | 'urgent'
  createdAt: number
}

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [configError, setConfigError] = useState('')

  const load = useCallback(async () => {
    setLoadError('')
    const res = await fetch('/api/tickets')
    if (res.status === 401) {
      window.location.href = '/login'
      return
    }
    if (res.status === 503) {
      setConfigError('Database is not configured. Set DATABASE_URL and restart the app.')
      setTickets([])
      return
    }
    if (!res.ok) {
      setLoadError('Could not load tickets.')
      return
    }
    const data = await res.json()
    setTickets(data.tickets ?? [])
    setConfigError('')
  }, [])

  useEffect(() => {
    void load().finally(() => setHydrated(true))
  }, [load])

  async function createTicket() {
    if (!title.trim()) return
    const res = await fetch('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), description: description.trim() })
    })
    if (res.status === 503) {
      setConfigError('Database is not configured. Set DATABASE_URL and restart the app.')
      return
    }
    if (!res.ok) return
    setTitle('')
    setDescription('')
    await load()
  }

  async function updateTicket(id: string, patch: Partial<Ticket>) {
    const res = await fetch(`/api/tickets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    })
    if (!res.ok) return
    const data = await res.json()
    const next = data.ticket as Ticket
    setTickets(current => current.map(t => (t.id === id ? { ...t, ...next } : t)))
  }

  if (!hydrated) {
    return (
      <main className="module-page">
        <p className="module-loading">Loading tickets</p>
      </main>
    )
  }

  return (
    <main className="module-page">
      <ModuleChrome
        title="Tickets"
        subtitle="Tickets are stored in PostgreSQL (schema aaelink). Sign in is required."
      />

      {configError ? <p className="form-error">{configError}</p> : null}
      {loadError ? <p className="form-error">{loadError}</p> : null}

      <section className="ticket-form-grid">
        <label className="field-label">
          Title
          <input className="slack-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs help?" />
        </label>
        <label className="field-label">
          Details
          <textarea
            className="slack-textarea"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Steps to reproduce, systems affected, urgency context."
            rows={4}
          />
        </label>
        <div className="ticket-form-actions">
          <button type="button" className="slack-button" onClick={() => void createTicket()}>
            Create ticket
          </button>
        </div>
      </section>

      <section className="ticket-list">
        {tickets.map(ticket => (
          <article className="ticket-card" key={ticket.id}>
            <div className="ticket-card-head">
              <div>
                <strong>{ticket.id}</strong>
                <span className="ticket-date">{new Date(ticket.createdAt).toLocaleString()}</span>
              </div>
              <span className={`priority-pill priority-${ticket.priority}`}>{ticket.priority}</span>
            </div>
            <h2>{ticket.title}</h2>
            {ticket.description ? <p className="ticket-desc">{ticket.description}</p> : null}
            <div className="ticket-controls">
              <label>
                Status
                <select
                  value={ticket.status}
                  onChange={e => void updateTicket(ticket.id, { status: e.target.value as Ticket['status'] })}
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In progress</option>
                  <option value="resolved">Resolved</option>
                </select>
              </label>
              <label>
                Priority
                <select
                  value={ticket.priority}
                  onChange={e => void updateTicket(ticket.id, { priority: e.target.value as Ticket['priority'] })}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
            </div>
          </article>
        ))}
      </section>
    </main>
  )
}
