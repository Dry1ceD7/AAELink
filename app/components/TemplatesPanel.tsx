'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  FileText, Plus, Search, Trash2, Edit3, X, Loader2,
  Upload, Save, AlertCircle, Eye, Layers, Tag, ToggleLeft, ToggleRight
} from 'lucide-react'

/* ─── types ───────────────────────────────────────────────────────────── */

interface Template {
  id: string
  name: string
  description: string
  category: string
  filename: string
  content_type: string
  size_bytes: number
  is_active: boolean
  placeholders: Array<{ key: string; label: string; type: string; default: string }>
  variables: Record<string, string>
  creator_username?: string
  created_at: number
}

interface TemplatesPanelProps {
  workspaceId: string
}

/* ─── component ───────────────────────────────────────────────────────── */

export function TemplatesPanel({ workspaceId }: TemplatesPanelProps) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  // Upload/Create form
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '', description: '', category: 'general', is_active: true
  })
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Preview
  const [previewId, setPreviewId] = useState<string | null>(null)

  const categories = ['general', 'invoice', 'contract', 'letter', 'report', 'proposal', 'hr', 'legal']

  const loadTemplates = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ workspace_id: workspaceId })
      if (search) params.set('q', search)
      if (categoryFilter) params.set('category', categoryFilter)
      const res = await fetch(`/api/templates?${params}`)
      if (res.ok) {
        const data = await res.json()
        setTemplates(data.templates || [])
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [workspaceId, search, categoryFilter])

  useEffect(() => { loadTemplates() }, [loadTemplates])

  const resetForm = () => {
    setForm({ name: '', description: '', category: 'general', is_active: true })
    setUploadFile(null)
    setEditingId(null)
    setError('')
  }

  const openCreate = () => { resetForm(); setFormOpen(true) }

  const openEdit = (t: Template) => {
    setForm({
      name: t.name,
      description: t.description,
      category: t.category,
      is_active: t.is_active
    })
    setEditingId(t.id)
    setFormOpen(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required'); return }
    if (!editingId && !uploadFile) { setError('Please select a template file'); return }
    setSaving(true); setError('')

    try {
      if (editingId) {
        // Update metadata via PUT
        const res = await fetch('/api/templates', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editingId,
            workspace_id: workspaceId,
            ...form
          })
        })
        if (!res.ok) {
          const data = await res.json()
          setError(data.error || 'Update failed')
        } else {
          setFormOpen(false); resetForm(); loadTemplates()
        }
      } else {
        // Create with file upload via POST multipart
        const fd = new FormData()
        fd.append('workspace_id', workspaceId)
        fd.append('name', form.name)
        fd.append('description', form.description)
        fd.append('category', form.category)
        if (uploadFile) fd.append('file', uploadFile)

        const res = await fetch('/api/templates', { method: 'POST', body: fd })
        if (!res.ok) {
          const data = await res.json()
          setError(data.error || 'Upload failed')
        } else {
          setFormOpen(false); resetForm(); loadTemplates()
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    }
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this template?')) return
    await fetch('/api/templates', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, workspace_id: workspaceId })
    })
    loadTemplates()
  }

  const toggleActive = async (t: Template) => {
    await fetch('/api/templates', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: t.id,
        workspace_id: workspaceId,
        is_active: !t.is_active
      })
    })
    loadTemplates()
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="module-panel templates-panel-module">
      {/* Header */}
      <div className="module-panel-header">
        <div className="module-panel-search">
          <Search size={15} />
          <input
            type="text"
            placeholder="Search templates..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="module-panel-filter"
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
        >
          <option value="">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
        </select>
        <button className="module-panel-add-btn" onClick={openCreate}>
          <Plus size={15} /> Upload Template
        </button>
      </div>

      {/* Create/Edit Form */}
      {formOpen && (
        <div className="module-panel-form">
          <div className="module-panel-form-header">
            <h3>{editingId ? 'Edit Template' : 'Upload Template'}</h3>
            <button className="module-panel-form-close" onClick={() => { setFormOpen(false); resetForm() }}>
              <X size={16} />
            </button>
          </div>

          <div className="module-panel-form-grid">
            <div className="module-panel-form-row">
              <label>Name *</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Invoice Template v2" />
            </div>
            <div className="module-panel-form-row">
              <label>Category</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {categories.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
            <div className="module-panel-form-row module-panel-form-row--full">
              <label>Description</label>
              <textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe this template..." />
            </div>

            {!editingId && (
              <div className="module-panel-form-row module-panel-form-row--full">
                <label>Template File *</label>
                <div className="module-panel-file-upload" onClick={() => fileInputRef.current?.click()}>
                  <input ref={fileInputRef} type="file" hidden onChange={e => setUploadFile(e.target.files?.[0] || null)}
                    accept=".docx,.doc,.pdf,.html,.htm,.txt,.csv,.md,.xlsx,.pptx" />
                  {uploadFile ? (
                    <div className="module-panel-file-info">
                      <FileText size={16} />
                      <span>{uploadFile.name}</span>
                      <span className="module-panel-file-size">{formatSize(uploadFile.size)}</span>
                    </div>
                  ) : (
                    <div className="module-panel-file-placeholder">
                      <Upload size={20} />
                      <span>Click to select file (.docx, .pdf, .html, etc.)</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {error && <div className="module-panel-error"><AlertCircle size={14} /> {error}</div>}

          <div className="module-panel-form-actions">
            <button className="module-panel-btn module-panel-btn--secondary" onClick={() => { setFormOpen(false); resetForm() }}>Cancel</button>
            <button className="module-panel-btn module-panel-btn--primary" onClick={handleSave} disabled={saving}>
              {saving ? <><Loader2 size={14} className="spin" /> Saving...</> : <><Save size={14} /> {editingId ? 'Update' : 'Upload'}</>}
            </button>
          </div>
        </div>
      )}

      {/* Templates List */}
      <div className="module-panel-list">
        {loading ? (
          <div className="module-panel-loading"><Loader2 size={20} className="spin" /> Loading templates...</div>
        ) : templates.length === 0 ? (
          <div className="module-panel-empty">
            <Layers size={40} strokeWidth={1.2} />
            <h3>No templates yet</h3>
            <p>Upload your first document template with {'{{placeholders}}'}.</p>
          </div>
        ) : (
          templates.map(t => (
            <div key={t.id} className={`module-panel-card${!t.is_active ? ' module-panel-card--inactive' : ''}`}>
              <div className="module-panel-card-header" onClick={() => setPreviewId(previewId === t.id ? null : t.id)}>
                <div className="module-panel-card-avatar module-panel-card-avatar--template">
                  <FileText size={18} />
                </div>
                <div className="module-panel-card-info">
                  <div className="module-panel-card-name">
                    {t.name}
                    {!t.is_active && <span className="module-panel-badge module-panel-badge--muted">Inactive</span>}
                  </div>
                  <div className="module-panel-card-meta">
                    <span><Tag size={11} /> {t.category}</span>
                    <span>{t.filename}</span>
                    <span>{formatSize(t.size_bytes)}</span>
                    {t.placeholders.length > 0 && <span>{t.placeholders.length} fields</span>}
                  </div>
                </div>
                <div className="module-panel-card-actions">
                  <button title={t.is_active ? 'Deactivate' : 'Activate'} onClick={e => { e.stopPropagation(); toggleActive(t) }}>
                    {t.is_active ? <ToggleRight size={16} className="module-panel-toggle--on" /> : <ToggleLeft size={16} />}
                  </button>
                  <button title="Edit" onClick={e => { e.stopPropagation(); openEdit(t) }}><Edit3 size={14} /></button>
                  <button title="Delete" onClick={e => { e.stopPropagation(); handleDelete(t.id) }}><Trash2 size={14} /></button>
                </div>
              </div>

              {previewId === t.id && (
                <div className="module-panel-card-expanded">
                  {t.description && <p className="module-panel-tmpl-desc">{t.description}</p>}
                  {t.creator_username && (
                    <div className="module-panel-detail">Created by @{t.creator_username}</div>
                  )}
                  {t.placeholders.length > 0 && (
                    <div className="module-panel-placeholders">
                      <strong>Detected Placeholders</strong>
                      <div className="module-panel-placeholder-chips">
                        {t.placeholders.map(p => (
                          <span key={p.key} className="module-panel-chip">{`{{${p.key}}}`}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
