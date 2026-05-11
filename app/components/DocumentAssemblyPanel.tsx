'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  FileText, Users, Layers, ChevronRight, Search, X, Plus, Trash2,
  Download, Eye, CheckCircle, AlertCircle, Loader2, ArrowLeft, Sparkles
} from 'lucide-react'

/* ─── types ───────────────────────────────────────────────────────────────── */

interface Template {
  id: string
  name: string
  description: string
  category: string
  filename: string
  content_type: string
  placeholders: Array<{ key: string; label: string; type: string; default: string }>
  variables: Record<string, string>
  creator_username?: string
}

interface ClientProfile {
  id: string
  name: string
  code: string
  email: string
  phone: string
  logo_url: string
}

interface FindReplaceRule {
  find: string
  replace: string
  case_sensitive: boolean
  whole_word: boolean
}

interface AssembledDoc {
  id: string
  filename: string
  contentType: string
  size: number
  createdAt: number
}

/* ─── props ───────────────────────────────────────────────────────────────── */

interface DocumentAssemblyPanelProps {
  workspaceId: string
  ticketId?: string
  onClose: () => void
  onDocumentCreated?: (doc: AssembledDoc) => void
}

/* ─── component ───────────────────────────────────────────────────────────── */

type AssemblyStep = 'template' | 'client' | 'variables' | 'review'

export default function DocumentAssemblyPanel({
  workspaceId, ticketId, onClose, onDocumentCreated,
}: DocumentAssemblyPanelProps) {
  const [step, setStep] = useState<AssemblyStep>('template')

  // Template selection
  const [templates, setTemplates] = useState<Template[]>([])
  const [templateSearch, setTemplateSearch] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  const [loadingTemplates, setLoadingTemplates] = useState(false)

  // Client selection
  const [clients, setClients] = useState<ClientProfile[]>([])
  const [clientSearch, setClientSearch] = useState('')
  const [selectedClient, setSelectedClient] = useState<ClientProfile | null>(null)
  const [loadingClients, setLoadingClients] = useState(false)

  // Variable values
  const [customVars, setCustomVars] = useState<Record<string, string>>({})
  const [findReplaceRules, setFindReplaceRules] = useState<FindReplaceRule[]>([])
  const [outputName, setOutputName] = useState('')

  // Assembly state
  const [assembling, setAssembling] = useState(false)
  const [result, setResult] = useState<AssembledDoc | null>(null)
  const [error, setError] = useState('')

  // ── Load templates ──

  const loadTemplates = useCallback(async () => {
    setLoadingTemplates(true)
    try {
      const params = new URLSearchParams({ workspace_id: workspaceId })
      if (templateSearch) params.set('q', templateSearch)
      const res = await fetch(`/api/templates?${params}`)
      if (res.ok) {
        const data = await res.json()
        setTemplates(data.templates || [])
      }
    } catch { /* ignore */ }
    setLoadingTemplates(false)
  }, [workspaceId, templateSearch])

  useEffect(() => { loadTemplates() }, [loadTemplates])

  // ── Load clients ──

  const loadClients = useCallback(async () => {
    setLoadingClients(true)
    try {
      const params = new URLSearchParams({ workspace_id: workspaceId })
      if (clientSearch) params.set('q', clientSearch)
      const res = await fetch(`/api/clients?${params}`)
      if (res.ok) {
        const data = await res.json()
        setClients(data.clients || [])
      }
    } catch { /* ignore */ }
    setLoadingClients(false)
  }, [workspaceId, clientSearch])

  useEffect(() => {
    if (step === 'client') loadClients()
  }, [step, loadClients])

  // ── Initialize variables when template is selected ──

  useEffect(() => {
    if (selectedTemplate) {
      const defaults: Record<string, string> = {}
      for (const ph of selectedTemplate.placeholders) {
        defaults[ph.key] = ph.default || ''
      }
      // Merge in template variables
      if (selectedTemplate.variables) {
        for (const [k, v] of Object.entries(selectedTemplate.variables)) {
          if (!defaults[k]) defaults[k] = v
        }
      }
      setCustomVars(defaults)
    }
  }, [selectedTemplate])

  // ── Assembly ──

  const handleAssemble = async () => {
    if (!selectedTemplate) return
    setAssembling(true)
    setError('')

    try {
      const payload: Record<string, unknown> = {
        workspace_id: workspaceId,
        template_id: selectedTemplate.id,
        custom_vars: customVars,
        output_name: outputName || undefined,
      }
      if (selectedClient) payload.client_id = selectedClient.id
      if (ticketId) payload.ticket_id = ticketId
      if (findReplaceRules.length > 0) {
        payload.find_replace = findReplaceRules.filter(r => r.find.trim())
      }

      const res = await fetch('/api/documents/assemble', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Assembly failed')

      const doc: AssembledDoc = {
        id: data.document.id,
        filename: data.document.filename,
        contentType: data.document.contentType,
        size: data.document.size,
        createdAt: data.document.createdAt,
      }
      setResult(doc)
      onDocumentCreated?.(doc)
      setStep('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }

    setAssembling(false)
  }

  // ── Find/Replace helpers ──

  const addFindReplaceRule = () => {
    setFindReplaceRules(prev => [...prev, { find: '', replace: '', case_sensitive: false, whole_word: false }])
  }

  const updateRule = (idx: number, field: keyof FindReplaceRule, value: string | boolean) => {
    setFindReplaceRules(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r))
  }

  const removeRule = (idx: number) => {
    setFindReplaceRules(prev => prev.filter((_, i) => i !== idx))
  }

  // ── Render ──

  const stepLabels: Record<AssemblyStep, string> = {
    template: 'Select Template',
    client: 'Select Client',
    variables: 'Fill Variables',
    review: 'Review & Generate',
  }

  const canProceed = () => {
    switch (step) {
      case 'template': return !!selectedTemplate
      case 'client': return true // client is optional
      case 'variables': return true
      case 'review': return !assembling
    }
  }

  const nextStep = () => {
    switch (step) {
      case 'template': setStep('client'); break
      case 'client': setStep('variables'); break
      case 'variables': setStep('review'); break
    }
  }

  const prevStep = () => {
    switch (step) {
      case 'client': setStep('template'); break
      case 'variables': setStep('client'); break
      case 'review': setStep('variables'); break
    }
  }

  return (
    <div className="assembly-panel">
      {/* Header */}
      <div className="assembly-panel-header">
        <div className="assembly-panel-title">
          <Sparkles size={18} />
          <span>Document Assembly</span>
        </div>
        <button className="assembly-panel-close" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      {/* Step indicator */}
      <div className="assembly-steps">
        {(['template', 'client', 'variables', 'review'] as AssemblyStep[]).map((s, i) => (
          <React.Fragment key={s}>
            <button
              className={`assembly-step-pill ${step === s ? 'active' : ''} ${
                (['template', 'client', 'variables', 'review'].indexOf(step) > i) ? 'done' : ''
              }`}
              onClick={() => {
                if (['template', 'client', 'variables', 'review'].indexOf(step) >= i) setStep(s)
              }}
            >
              <span className="assembly-step-number">{i + 1}</span>
              <span className="assembly-step-label">{stepLabels[s]}</span>
            </button>
            {i < 3 && <ChevronRight size={14} className="assembly-step-arrow" />}
          </React.Fragment>
        ))}
      </div>

      {/* Step content */}
      <div className="assembly-content">

        {/* ── Step 1: Template Selection ── */}
        {step === 'template' && (
          <div className="assembly-step-content">
            <div className="assembly-search-row">
              <Search size={16} />
              <input
                type="text"
                placeholder="Search templates..."
                value={templateSearch}
                onChange={e => setTemplateSearch(e.target.value)}
                className="assembly-search-input"
              />
            </div>

            <div className="assembly-list">
              {loadingTemplates ? (
                <div className="assembly-loading"><Loader2 size={20} className="spin" /> Loading templates...</div>
              ) : templates.length === 0 ? (
                <div className="assembly-empty">No templates found. Upload one first.</div>
              ) : (
                templates.map(t => (
                  <button
                    key={t.id}
                    className={`assembly-list-item ${selectedTemplate?.id === t.id ? 'selected' : ''}`}
                    onClick={() => setSelectedTemplate(t)}
                  >
                    <FileText size={18} />
                    <div className="assembly-list-item-info">
                      <div className="assembly-list-item-name">{t.name}</div>
                      <div className="assembly-list-item-meta">
                        {t.category} · {t.filename}
                        {t.placeholders.length > 0 && ` · ${t.placeholders.length} fields`}
                      </div>
                    </div>
                    {selectedTemplate?.id === t.id && <CheckCircle size={18} className="assembly-check" />}
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* ── Step 2: Client Selection ── */}
        {step === 'client' && (
          <div className="assembly-step-content">
            <div className="assembly-info-banner">
              Client selection is optional. Skip to fill variables directly.
            </div>

            <div className="assembly-search-row">
              <Search size={16} />
              <input
                type="text"
                placeholder="Search clients..."
                value={clientSearch}
                onChange={e => setClientSearch(e.target.value)}
                className="assembly-search-input"
              />
            </div>

            <div className="assembly-list">
              {loadingClients ? (
                <div className="assembly-loading"><Loader2 size={20} className="spin" /> Loading clients...</div>
              ) : clients.length === 0 ? (
                <div className="assembly-empty">No clients found.</div>
              ) : (
                clients.map(c => (
                  <button
                    key={c.id}
                    className={`assembly-list-item ${selectedClient?.id === c.id ? 'selected' : ''}`}
                    onClick={() => setSelectedClient(prev => prev?.id === c.id ? null : c)}
                  >
                    <Users size={18} />
                    <div className="assembly-list-item-info">
                      <div className="assembly-list-item-name">{c.name}</div>
                      <div className="assembly-list-item-meta">
                        {c.code && `${c.code} · `}{c.email}
                      </div>
                    </div>
                    {selectedClient?.id === c.id && <CheckCircle size={18} className="assembly-check" />}
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* ── Step 3: Variables ── */}
        {step === 'variables' && (
          <div className="assembly-step-content">
            {/* Custom variables from template placeholders */}
            {selectedTemplate && selectedTemplate.placeholders.length > 0 && (
              <div className="assembly-variables-section">
                <h4 className="assembly-section-title">Template Variables</h4>
                {selectedTemplate.placeholders.map(ph => (
                  <div key={ph.key} className="assembly-var-row">
                    <label className="assembly-var-label">{ph.label}</label>
                    <input
                      type={ph.type === 'number' ? 'number' : 'text'}
                      className="assembly-var-input"
                      value={customVars[ph.key] || ''}
                      onChange={e => setCustomVars(prev => ({ ...prev, [ph.key]: e.target.value }))}
                      placeholder={ph.default || `Enter ${ph.label}...`}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Find & Replace rules */}
            <div className="assembly-variables-section">
              <div className="assembly-section-header">
                <h4 className="assembly-section-title">Find & Replace</h4>
                <button className="assembly-add-btn" onClick={addFindReplaceRule}>
                  <Plus size={14} /> Add Rule
                </button>
              </div>

              {findReplaceRules.map((rule, idx) => (
                <div key={idx} className="assembly-fr-row">
                  <div className="assembly-fr-inputs">
                    <input
                      type="text"
                      placeholder="Find..."
                      value={rule.find}
                      onChange={e => updateRule(idx, 'find', e.target.value)}
                      className="assembly-var-input"
                    />
                    <span className="assembly-fr-arrow">→</span>
                    <input
                      type="text"
                      placeholder="Replace with..."
                      value={rule.replace}
                      onChange={e => updateRule(idx, 'replace', e.target.value)}
                      className="assembly-var-input"
                    />
                  </div>
                  <div className="assembly-fr-options">
                    <label className="assembly-fr-toggle">
                      <input
                        type="checkbox"
                        checked={rule.case_sensitive}
                        onChange={e => updateRule(idx, 'case_sensitive', e.target.checked)}
                      />
                      <span>Aa</span>
                    </label>
                    <label className="assembly-fr-toggle">
                      <input
                        type="checkbox"
                        checked={rule.whole_word}
                        onChange={e => updateRule(idx, 'whole_word', e.target.checked)}
                      />
                      <span>W</span>
                    </label>
                    <button className="assembly-fr-remove" onClick={() => removeRule(idx)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Output name */}
            <div className="assembly-variables-section">
              <h4 className="assembly-section-title">Output Filename</h4>
              <input
                type="text"
                className="assembly-var-input assembly-var-input-full"
                value={outputName}
                onChange={e => setOutputName(e.target.value)}
                placeholder="Auto-generated if blank"
              />
            </div>
          </div>
        )}

        {/* ── Step 4: Review & Generate ── */}
        {step === 'review' && (
          <div className="assembly-step-content">
            {result ? (
              <div className="assembly-success">
                <CheckCircle size={40} className="assembly-success-icon" />
                <h3>Document Generated!</h3>
                <p className="assembly-success-filename">{result.filename}</p>
                <p className="assembly-success-meta">
                  {(result.size / 1024).toFixed(1)} KB · {result.contentType}
                </p>
                <div className="assembly-success-actions">
                  <a
                    href={`/api/documents/${result.id}/download`}
                    className="assembly-btn assembly-btn-primary"
                  >
                    <Download size={16} /> Download
                  </a>
                  <button
                    className="assembly-btn assembly-btn-secondary"
                    onClick={() => { setResult(null); setStep('template') }}
                  >
                    <Plus size={16} /> Create Another
                  </button>
                </div>
              </div>
            ) : (
              <div className="assembly-review">
                <div className="assembly-review-summary">
                  <div className="assembly-review-row">
                    <span className="assembly-review-label">Template</span>
                    <span className="assembly-review-value">{selectedTemplate?.name}</span>
                  </div>
                  <div className="assembly-review-row">
                    <span className="assembly-review-label">Client</span>
                    <span className="assembly-review-value">
                      {selectedClient ? selectedClient.name : 'None'}
                    </span>
                  </div>
                  <div className="assembly-review-row">
                    <span className="assembly-review-label">Variables</span>
                    <span className="assembly-review-value">
                      {Object.keys(customVars).filter(k => customVars[k]).length} filled
                    </span>
                  </div>
                  <div className="assembly-review-row">
                    <span className="assembly-review-label">Find/Replace</span>
                    <span className="assembly-review-value">
                      {findReplaceRules.filter(r => r.find.trim()).length} rules
                    </span>
                  </div>
                  {ticketId && (
                    <div className="assembly-review-row">
                      <span className="assembly-review-label">Linked Ticket</span>
                      <span className="assembly-review-value">{ticketId}</span>
                    </div>
                  )}
                </div>

                {error && (
                  <div className="assembly-error">
                    <AlertCircle size={16} /> {error}
                  </div>
                )}

                <button
                  className="assembly-btn assembly-btn-primary assembly-btn-generate"
                  onClick={handleAssemble}
                  disabled={assembling}
                >
                  {assembling ? (
                    <><Loader2 size={16} className="spin" /> Generating...</>
                  ) : (
                    <><Sparkles size={16} /> Generate Document</>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer navigation */}
      {step !== 'review' || !result ? (
        <div className="assembly-footer">
          {step !== 'template' && (
            <button className="assembly-btn assembly-btn-secondary" onClick={prevStep}>
              <ArrowLeft size={16} /> Back
            </button>
          )}
          <div className="assembly-footer-spacer" />
          {step !== 'review' && (
            <button
              className="assembly-btn assembly-btn-primary"
              onClick={nextStep}
              disabled={!canProceed()}
            >
              Next <ChevronRight size={16} />
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}
