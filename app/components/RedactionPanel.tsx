'use client'

import { useCallback, useState } from 'react'
import {
  Eraser, Plus, Trash2, Shield, AlertTriangle, CheckCircle,
  ToggleLeft, ToggleRight
} from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'

// ── Types ───────────────────────────────────────────────────────────────────

interface RedactionEntry {
  id: string
  text: string
  useRegex: boolean
}

const REDACTION_COLORS = [
  { value: '#000000', label: 'Black' },
  { value: '#FF0000', label: 'Red' },
  { value: '#FFFFFF', label: 'White' },
  { value: '#808080', label: 'Gray' },
]

// ── Main Component ──────────────────────────────────────────────────────────

interface RedactionPanelProps {
  documentId: string
  workspaceId: string
  open: boolean
  onClose: () => void
  onOperationComplete: (doc: { id: string; filename: string }) => void
}

export function RedactionPanel({
  documentId,
  workspaceId,
  open,
  onClose,
  onOperationComplete,
}: RedactionPanelProps) {
  const [entries, setEntries] = useState<RedactionEntry[]>([
    { id: 'init', text: '', useRegex: false }
  ])
  const [redactColor, setRedactColor] = useState('#000000')
  const [convertToImage, setConvertToImage] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const addEntry = useCallback(() => {
    const id = `red_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    setEntries(prev => [...prev, { id, text: '', useRegex: false }])
  }, [])

  const updateEntry = useCallback((id: string, updates: Partial<RedactionEntry>) => {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e))
  }, [])

  const removeEntry = useCallback((id: string) => {
    setEntries(prev => prev.length > 1 ? prev.filter(e => e.id !== id) : prev)
  }, [])

  const runRedaction = useCallback(async () => {
    const valid = entries.filter(e => e.text.trim())
    if (valid.length === 0) {
      setError('Enter at least one text to redact')
      return
    }

    setBusy(true)
    setError('')
    setSuccess('')

    try {
      // Process each entry as a separate redaction, chaining results
      const searchText = valid.map(e => e.text.trim()).join('\n')
      const hasRegex = valid.some(e => e.useRegex)

      const res = await apiFetch('/api/documents/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'redact',
          document_ids: [documentId],
          workspace_id: workspaceId,
          search_text: searchText,
          use_regex: hasRegex,
          redact_color: redactColor,
          convert_to_image: convertToImage,
        }),
      })

      if (res.ok) {
        const data = await res.json() as { document?: { id: string; filename: string } }
        if (data.document) {
          setSuccess(`Redacted ${valid.length} term${valid.length > 1 ? 's' : ''} successfully`)
          onOperationComplete(data.document)
        }
      } else {
        const data = await res.json().catch(() => ({})) as { error?: string; detail?: string }
        setError(data.detail || data.error || 'Redaction failed')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed')
    } finally {
      setBusy(false)
    }
  }, [entries, documentId, workspaceId, redactColor, convertToImage, onOperationComplete])

  if (!open) return null

  return (
    <div className="redact-panel">
      <div className="redact-panel-header">
        <h3><Shield size={16} /> Secure Redaction</h3>
        <button type="button" className="mm-icon-btn" onClick={onClose} title="Close">
          <span style={{ fontSize: 16 }}>×</span>
        </button>
      </div>

      <p className="redact-desc">
        Permanently remove sensitive text from the PDF. Redacted content cannot be recovered.
      </p>

      {/* Redaction entries */}
      <div className="redact-entries">
        {entries.map((entry, i) => (
          <div key={entry.id} className="redact-entry">
            <span className="redact-entry-num">{i + 1}</span>
            <div className="redact-entry-body">
              <input
                type="text"
                className="redact-entry-input"
                value={entry.text}
                onChange={e => updateEntry(entry.id, { text: e.target.value })}
                placeholder={entry.useRegex ? 'Regex pattern…' : 'Text to redact…'}
                autoFocus={i === entries.length - 1}
              />
              <button
                type="button"
                className={`redact-regex-toggle${entry.useRegex ? ' redact-regex-toggle--active' : ''}`}
                title={entry.useRegex ? 'Using regex' : 'Literal text'}
                onClick={() => updateEntry(entry.id, { useRegex: !entry.useRegex })}
              >
                .*
              </button>
            </div>
            {entries.length > 1 && (
              <button type="button" className="mm-icon-btn" title="Remove"
                onClick={() => removeEntry(entry.id)}>
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}

        <button type="button" className="redact-add-btn" onClick={addEntry}>
          <Plus size={13} /> Add another term
        </button>
      </div>

      {/* Options */}
      <div className="redact-options">
        <div className="redact-option-row">
          <span className="redact-option-label">Redaction color</span>
          <div className="redact-color-picker">
            {REDACTION_COLORS.map(c => (
              <button
                key={c.value}
                type="button"
                className={`redact-color-btn${redactColor === c.value ? ' redact-color-btn--active' : ''}`}
                style={{ background: c.value, border: c.value === '#FFFFFF' ? '1px solid #ddd' : 'none' }}
                onClick={() => setRedactColor(c.value)}
                title={c.label}
              />
            ))}
          </div>
        </div>

        <div className="redact-option-row">
          <span className="redact-option-label">Convert to image (extra security)</span>
          <button
            type="button"
            className="redact-toggle-btn"
            onClick={() => setConvertToImage(o => !o)}
          >
            {convertToImage
              ? <><ToggleRight size={20} className="redact-toggle-on" /> On</>
              : <><ToggleLeft size={20} /> Off</>
            }
          </button>
        </div>
      </div>

      {/* Submit */}
      <div className="redact-actions">
        {error && (
          <p className="redact-error">
            <AlertTriangle size={12} /> {error}
          </p>
        )}
        {success && (
          <p className="redact-success">
            <CheckCircle size={12} /> {success}
          </p>
        )}
        <div className="redact-warn">
          <AlertTriangle size={12} />
          <span>Redaction is permanent and cannot be undone.</span>
        </div>
        <button
          type="button"
          className="slack-button redact-submit-btn"
          disabled={busy || entries.every(e => !e.text.trim())}
          onClick={runRedaction}
        >
          <Eraser size={14} /> {busy ? 'Redacting…' : 'Apply Redaction'}
        </button>
      </div>
    </div>
  )
}
