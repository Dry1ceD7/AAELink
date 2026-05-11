'use client'

import { useCallback, useState } from 'react'
import {
  TextCursorInput, CheckSquare, List, Plus, Trash2, Send,
  FileText, AlertTriangle
} from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'

// ── Types ───────────────────────────────────────────────────────────────────

type FieldType = 'text' | 'checkbox' | 'dropdown'

interface FormField {
  id: string
  type: FieldType
  label: string
  value: string
  options?: string[]       // dropdown options
  page?: number
  x?: number
  y?: number
  width?: number
  height?: number
}

// ── Form Field Row ──────────────────────────────────────────────────────────

function FormFieldRow({
  field,
  onChange,
  onRemove,
}: {
  field: FormField
  onChange: (id: string, updates: Partial<FormField>) => void
  onRemove: (id: string) => void
}) {
  const icon = field.type === 'text' ? <TextCursorInput size={14} />
    : field.type === 'checkbox' ? <CheckSquare size={14} />
    : <List size={14} />

  return (
    <div className="formfield-row">
      <span className="formfield-row-icon">{icon}</span>

      <div className="formfield-row-body">
        <input
          type="text"
          className="formfield-label-input"
          value={field.label}
          onChange={e => onChange(field.id, { label: e.target.value })}
          placeholder="Field label"
        />

        {field.type === 'text' && (
          <input
            type="text"
            className="formfield-value-input"
            value={field.value}
            onChange={e => onChange(field.id, { value: e.target.value })}
            placeholder="Enter value…"
          />
        )}

        {field.type === 'checkbox' && (
          <label className="formfield-checkbox-wrap">
            <input
              type="checkbox"
              checked={field.value === 'true'}
              onChange={e => onChange(field.id, { value: String(e.target.checked) })}
            />
            <span>{field.value === 'true' ? 'Checked' : 'Unchecked'}</span>
          </label>
        )}

        {field.type === 'dropdown' && (
          <div className="formfield-dropdown-wrap">
            <select
              className="formfield-select"
              value={field.value}
              onChange={e => onChange(field.id, { value: e.target.value })}
            >
              <option value="">Select…</option>
              {(field.options || []).map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            <input
              type="text"
              className="formfield-options-input"
              placeholder="Options (comma-separated)"
              defaultValue={(field.options || []).join(', ')}
              onBlur={e => {
                const opts = e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                onChange(field.id, { options: opts })
              }}
            />
          </div>
        )}
      </div>

      <button type="button" className="mm-icon-btn" title="Remove" onClick={() => onRemove(field.id)}>
        <Trash2 size={13} />
      </button>
    </div>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────

interface PdfFormFieldsPanelProps {
  documentId: string
  workspaceId: string
  open: boolean
  onClose: () => void
  onOperationComplete: (doc: { id: string; filename: string }) => void
}

export function PdfFormFieldsPanel({
  documentId,
  workspaceId,
  open,
  onClose,
  onOperationComplete,
}: PdfFormFieldsPanelProps) {
  const [fields, setFields] = useState<FormField[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const addField = useCallback((type: FieldType) => {
    const id = `field_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    setFields(prev => [...prev, {
      id,
      type,
      label: '',
      value: '',
      options: type === 'dropdown' ? ['Option A', 'Option B'] : undefined,
    }])
  }, [])

  const updateField = useCallback((id: string, updates: Partial<FormField>) => {
    setFields(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f))
  }, [])

  const removeField = useCallback((id: string) => {
    setFields(prev => prev.filter(f => f.id !== id))
  }, [])

  const submitForm = useCallback(async () => {
    const filledFields = fields.filter(f => f.label.trim() && f.value.trim())
    if (filledFields.length === 0) {
      setError('Add at least one field with a label and value')
      return
    }

    setBusy(true)
    setError('')
    setSuccess('')

    try {
      // Use the operations API with form_fill operation
      const res = await apiFetch('/api/documents/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'form_fill',
          document_ids: [documentId],
          workspace_id: workspaceId,
          form_fields: filledFields.map(f => ({
            name: f.label,
            value: f.value,
            type: f.type,
          })),
        }),
      })

      if (res.ok) {
        const data = await res.json() as { document?: { id: string; filename: string } }
        if (data.document) {
          setSuccess('Form filled successfully!')
          onOperationComplete(data.document)
        }
      } else {
        const data = await res.json().catch(() => ({})) as { error?: string; detail?: string }
        setError(data.detail || data.error || 'Form fill failed')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed')
    } finally {
      setBusy(false)
    }
  }, [fields, documentId, workspaceId, onOperationComplete])

  if (!open) return null

  return (
    <div className="formfield-panel">
      <div className="formfield-panel-header">
        <h3><FileText size={16} /> Form Fields</h3>
        <button type="button" className="mm-icon-btn" onClick={onClose} title="Close">
          <span style={{ fontSize: 16 }}>×</span>
        </button>
      </div>

      <p className="formfield-desc">
        Define form fields to fill in the PDF. Each field maps to a named form field in the document.
      </p>

      {/* Add field buttons */}
      <div className="formfield-add-row">
        <button type="button" className="formfield-add-btn" onClick={() => addField('text')}>
          <TextCursorInput size={13} /> Text
        </button>
        <button type="button" className="formfield-add-btn" onClick={() => addField('checkbox')}>
          <CheckSquare size={13} /> Checkbox
        </button>
        <button type="button" className="formfield-add-btn" onClick={() => addField('dropdown')}>
          <List size={13} /> Dropdown
        </button>
      </div>

      {/* Fields list */}
      <div className="formfield-list">
        {fields.length === 0 ? (
          <p className="formfield-empty">
            No fields added. Click a button above to add form fields.
          </p>
        ) : (
          fields.map(f => (
            <FormFieldRow
              key={f.id}
              field={f}
              onChange={updateField}
              onRemove={removeField}
            />
          ))
        )}
      </div>

      {/* Submit */}
      <div className="formfield-actions">
        {error && (
          <p className="formfield-error">
            <AlertTriangle size={12} /> {error}
          </p>
        )}
        {success && (
          <p className="formfield-success">{success}</p>
        )}
        <button
          type="button"
          className="slack-button"
          disabled={busy || fields.length === 0}
          onClick={submitForm}
        >
          <Send size={14} /> {busy ? 'Filling…' : 'Fill Form'}
        </button>
      </div>
    </div>
  )
}
