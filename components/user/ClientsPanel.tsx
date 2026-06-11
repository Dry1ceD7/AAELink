'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  Users, Plus, Search, Trash2, Edit3, X, Loader2, ChevronDown, ChevronUp,
  Mail, Phone, MapPin, Building2, FileText, Save, AlertCircle
} from 'lucide-react'
import { useConfirm } from '@/components/a11y'

/* ─── types ───────────────────────────────────────────────────────────── */

interface ClientProfile {
  id: string
  name: string
  code: string
  email: string
  phone: string
  address_line1: string
  address_line2: string
  city: string
  state: string
  postal_code: string
  country: string
  tax_id: string
  legal_boilerplate: string
  logo_url: string
  created_at: number
}

interface ClientsPanelProps {
  workspaceId: string
}

/* ─── component ───────────────────────────────────────────────────────── */

export function ClientsPanel({ workspaceId }: ClientsPanelProps) {
  const { confirm, confirmDialog } = useConfirm()
  const [clients, setClients] = useState<ClientProfile[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const limit = 25

  // Form state
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '', code: '', email: '', phone: '',
    address_line1: '', address_line2: '', city: '', state: '', postal_code: '', country: '',
    tax_id: '', legal_boilerplate: ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Expanded card
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const loadClients = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ workspace_id: workspaceId, limit: String(limit), offset: String(offset) })
      if (search) params.set('q', search)
      const res = await fetch(`/api/clients?${params}`)
      if (res.ok) {
        const data = await res.json()
        setClients(data.clients || [])
        setTotal(data.total ?? 0)
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [workspaceId, search, offset])

  useEffect(() => { loadClients() }, [loadClients])

  const resetForm = () => {
    setForm({ name: '', code: '', email: '', phone: '', address_line1: '', address_line2: '', city: '', state: '', postal_code: '', country: '', tax_id: '', legal_boilerplate: '' })
    setEditingId(null)
    setError('')
  }

  const openCreate = () => { resetForm(); setFormOpen(true) }

  const openEdit = (c: ClientProfile) => {
    setForm({
      name: c.name, code: c.code, email: c.email, phone: c.phone,
      address_line1: c.address_line1, address_line2: c.address_line2,
      city: c.city, state: c.state, postal_code: c.postal_code, country: c.country,
      tax_id: c.tax_id, legal_boilerplate: c.legal_boilerplate
    })
    setEditingId(c.id)
    setFormOpen(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true); setError('')
    try {
      const url = editingId ? '/api/clients' : '/api/clients'
      const method = editingId ? 'PATCH' : 'POST'
      const body: Record<string, string> = { workspace_id: workspaceId, ...form }
      if (editingId) body.id = editingId
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Save failed')
      } else {
        setFormOpen(false); resetForm(); loadClients()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    }
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    if (!(await confirm({ title: 'Delete client', message: 'Delete this client profile?', danger: true, confirmLabel: 'Delete' }))) return
    await fetch('/api/clients', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, workspace_id: workspaceId })
    })
    loadClients()
  }

  const pages = Math.ceil(total / limit)
  const currentPage = Math.floor(offset / limit) + 1

  return (
    <>
    <div className="module-panel clients-panel-module">
      {/* Header */}
      <div className="module-panel-header">
        <div className="module-panel-search">
          <Search size={15} />
          <input
            type="text"
            placeholder="Search clients..."
            value={search}
            onChange={e => { setSearch(e.target.value); setOffset(0) }}
          />
        </div>
        <button className="module-panel-add-btn" onClick={openCreate}>
          <Plus size={15} /> New Client
        </button>
      </div>

      {/* Create/Edit Form */}
      {formOpen && (
        <div className="module-panel-form">
          <div className="module-panel-form-header">
            <h3>{editingId ? 'Edit Client' : 'New Client Profile'}</h3>
            <button className="module-panel-form-close" onClick={() => { setFormOpen(false); resetForm() }}>
              <X size={16} />
            </button>
          </div>

          <div className="module-panel-form-grid">
            <div className="module-panel-form-row">
              <label>Name *</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Company Name" />
            </div>
            <div className="module-panel-form-row">
              <label>Code</label>
              <input type="text" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="CLIENT-001" />
            </div>
            <div className="module-panel-form-row">
              <label>Email</label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="contact@company.com" />
            </div>
            <div className="module-panel-form-row">
              <label>Phone</label>
              <input type="text" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+66 2 xxx xxxx" />
            </div>
            <div className="module-panel-form-row module-panel-form-row--full">
              <label>Address Line 1</label>
              <input type="text" value={form.address_line1} onChange={e => setForm(f => ({ ...f, address_line1: e.target.value }))} placeholder="123 Street Name" />
            </div>
            <div className="module-panel-form-row module-panel-form-row--full">
              <label>Address Line 2</label>
              <input type="text" value={form.address_line2} onChange={e => setForm(f => ({ ...f, address_line2: e.target.value }))} placeholder="Suite 100" />
            </div>
            <div className="module-panel-form-row">
              <label>City</label>
              <input type="text" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="Bangkok" />
            </div>
            <div className="module-panel-form-row">
              <label>State / Province</label>
              <input type="text" value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} />
            </div>
            <div className="module-panel-form-row">
              <label>Postal Code</label>
              <input type="text" value={form.postal_code} onChange={e => setForm(f => ({ ...f, postal_code: e.target.value }))} placeholder="10110" />
            </div>
            <div className="module-panel-form-row">
              <label>Country</label>
              <input type="text" value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} placeholder="Thailand" />
            </div>
            <div className="module-panel-form-row">
              <label>Tax ID</label>
              <input type="text" value={form.tax_id} onChange={e => setForm(f => ({ ...f, tax_id: e.target.value }))} />
            </div>
            <div className="module-panel-form-row module-panel-form-row--full">
              <label>Legal Boilerplate</label>
              <textarea rows={3} value={form.legal_boilerplate} onChange={e => setForm(f => ({ ...f, legal_boilerplate: e.target.value }))} placeholder="Standard contract terms..." />
            </div>
          </div>

          {error && <div className="module-panel-error"><AlertCircle size={14} /> {error}</div>}

          <div className="module-panel-form-actions">
            <button className="module-panel-btn module-panel-btn--secondary" onClick={() => { setFormOpen(false); resetForm() }}>Cancel</button>
            <button className="module-panel-btn module-panel-btn--primary" onClick={handleSave} disabled={saving}>
              {saving ? <><Loader2 size={14} className="spin" /> Saving...</> : <><Save size={14} /> {editingId ? 'Update' : 'Create'}</>}
            </button>
          </div>
        </div>
      )}

      {/* Client List */}
      <div className="module-panel-list">
        {loading ? (
          <div className="module-panel-loading"><Loader2 size={20} className="spin" /> Loading clients...</div>
        ) : clients.length === 0 ? (
          <div className="module-panel-empty">
            <Building2 size={40} strokeWidth={1.2} />
            <h3>No client profiles yet</h3>
            <p>Create your first client to use with document templates.</p>
          </div>
        ) : (
          clients.map(c => (
            <div key={c.id} className="module-panel-card">
              <div className="module-panel-card-header" onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}>
                <div className="module-panel-card-avatar">{c.name.slice(0, 1).toUpperCase()}</div>
                <div className="module-panel-card-info">
                  <div className="module-panel-card-name">{c.name}</div>
                  <div className="module-panel-card-meta">
                    {c.code && <span>{c.code}</span>}
                    {c.email && <span><Mail size={11} /> {c.email}</span>}
                  </div>
                </div>
                <div className="module-panel-card-actions">
                  <button title="Edit" onClick={(e) => { e.stopPropagation(); openEdit(c) }}><Edit3 size={14} /></button>
                  <button title="Delete" onClick={(e) => { e.stopPropagation(); handleDelete(c.id) }}><Trash2 size={14} /></button>
                  {expandedId === c.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>
              </div>
              {expandedId === c.id && (
                <div className="module-panel-card-expanded">
                  {c.phone && <div className="module-panel-detail"><Phone size={13} /> {c.phone}</div>}
                  {(c.address_line1 || c.city) && (
                    <div className="module-panel-detail">
                      <MapPin size={13} />
                      <span>{[c.address_line1, c.address_line2, c.city, c.state, c.postal_code, c.country].filter(Boolean).join(', ')}</span>
                    </div>
                  )}
                  {c.tax_id && <div className="module-panel-detail"><FileText size={13} /> Tax ID: {c.tax_id}</div>}
                  {c.legal_boilerplate && (
                    <div className="module-panel-detail module-panel-detail--block">
                      <strong>Legal Boilerplate</strong>
                      <p>{c.legal_boilerplate}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="module-panel-pagination">
          <button disabled={currentPage <= 1} onClick={() => setOffset(Math.max(0, offset - limit))}>← Prev</button>
          <span>Page {currentPage} of {pages}</span>
          <button disabled={currentPage >= pages} onClick={() => setOffset(offset + limit)}>Next →</button>
        </div>
      )}
    </div>
    {confirmDialog}
    </>
  )
}
