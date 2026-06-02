'use client'

/**
 * Modal that creates a Puzzle Box assembly and (optionally) drives the
 * pipeline forward through ingest. The user picks:
 *
 *   - input mode: paste text, upload file (text-extracted server-side),
 *     or paste a pre-built PuzzlePiece JSON
 *   - HTML/CSS template (Puzzle Box `kind=html`/etc) and optional client
 *   - extraction strategy (auto / regex / llm)
 *   - target channel for delivery (optional)
 *
 * On confirm: POST /api/documents/assemblies, then POST .../ingest. The
 * pipeline panel re-fetches once the modal closes.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Sparkles, AlertCircle, Loader2, FileText, Type, Code } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'

interface Template {
  id: string
  kind: string
  name: string
  version: number
  page_size: string
  required_fields: string[]
  is_active: boolean
}

interface ClientOption {
  id: string
  name: string
  code: string
}

interface ChannelOption {
  id: string
  name: string
  display_name: string
}

interface Props {
  workspaceId: string
  /** Pre-fill the assembly with this ticket id (so the pipeline links back). */
  ticketId?: string
  /** Pre-fill the raw text (e.g. ticket description). */
  initialRawText?: string
  /** Default delivery channel id. */
  initialChannelId?: string
  onClose: () => void
  onCreated: (assemblyId: string) => void
}

type InputMode = 'text' | 'file' | 'piece'

export function AssemblyIngestModal({
  workspaceId, ticketId, initialRawText, initialChannelId, onClose, onCreated,
}: Props) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [clients, setClients] = useState<ClientOption[]>([])
  const [channels, setChannels] = useState<ChannelOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [templateId, setTemplateId] = useState('')
  const [clientId, setClientId] = useState('')
  const [channelId, setChannelId] = useState(initialChannelId || '')
  const [strategy, setStrategy] = useState<'auto' | 'regex' | 'llm'>('auto')
  const [inputMode, setInputMode] = useState<InputMode>(initialRawText ? 'text' : 'text')
  const [rawText, setRawText] = useState(initialRawText || '')
  const [pieceJson, setPieceJson] = useState('{\n  "schema_version": "1",\n  "source": { "kind": "manual", "ref": "" },\n  "customer_id": "",\n  "document_kind": "invoice",\n  "fields": {},\n  "extraction": { "method": "manual", "confidence": 1, "warnings": [] }\n}')
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)

  /* ─── load options ─── */

  useEffect(() => {
    void (async () => {
      setLoading(true)
      try {
        const [tplRes, cliRes, chRes] = await Promise.all([
          apiFetch(`/api/documents/templates?workspace_id=${encodeURIComponent(workspaceId)}`),
          apiFetch(`/api/clients?workspace_id=${encodeURIComponent(workspaceId)}&limit=200`),
          apiFetch(`/api/channels?workspace_id=${encodeURIComponent(workspaceId)}`),
        ])
        if (tplRes.ok) {
          const d = (await tplRes.json()) as { templates?: Template[] }
          setTemplates((d.templates || []).filter(t => t.is_active))
        }
        if (cliRes.ok) {
          const d = (await cliRes.json()) as { clients?: ClientOption[] }
          setClients(d.clients || [])
        }
        if (chRes.ok) {
          const d = (await chRes.json()) as { channels?: ChannelOption[] }
          setChannels((d.channels || []).filter(c => !!c.id))
        }
      } catch {
        setError('Could not load options.')
      } finally {
        setLoading(false)
      }
    })()
  }, [workspaceId])

  // Auto-select the first template if there is one
  useEffect(() => {
    if (templates.length && !templateId) setTemplateId(templates[0].id)
  }, [templates, templateId])

  /* ─── submit ─── */

  const submit = useCallback(async () => {
    setError('')

    if (!templateId) {
      setError('Pick a template.')
      return
    }
    if (inputMode === 'text' && !rawText.trim()) {
      setError('Paste some text to extract from.')
      return
    }
    if (inputMode === 'file' && !uploadedFile) {
      setError('Choose a file to ingest.')
      return
    }

    let prebuiltPiece: Record<string, unknown> | undefined
    if (inputMode === 'piece') {
      try {
        prebuiltPiece = JSON.parse(pieceJson)
      } catch (e) {
        setError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`)
        return
      }
    }

    let textForIngest = rawText
    if (inputMode === 'file' && uploadedFile) {
      // Read text from the file (UTF-8 best-effort). For PDFs the user
      // is expected to OCR/convert first; we still pass raw bytes as
      // a string for regex extraction to chew on.
      try {
        textForIngest = await uploadedFile.text()
      } catch {
        setError('Could not read file content.')
        return
      }
    }

    setBusy(true)
    try {
      // 1) Create the assembly row
      const createRes = await apiFetch('/api/documents/assemblies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          template_id: templateId,
          client_profile_id: clientId || null,
          delivery_channel_id: channelId || null,
          ticket_id: ticketId || null,
        }),
      })
      if (!createRes.ok) {
        const d = await createRes.json().catch(() => ({}))
        setError(d.error || 'Could not create assembly.')
        return
      }
      const { assembly } = (await createRes.json()) as { assembly: { id: string } }

      // 2) Drive ingest forward
      const ingestRes = await apiFetch(`/api/documents/assemblies/${encodeURIComponent(assembly.id)}/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raw_text: inputMode === 'piece' ? '' : textForIngest,
          prebuilt_piece: prebuiltPiece,
          source_kind: inputMode === 'file' ? 'upload' : (ticketId ? 'ticket' : 'manual'),
          source_ref: ticketId || (uploadedFile?.name || ''),
          strategy,
        }),
      })
      if (!ingestRes.ok) {
        const d = await ingestRes.json().catch(() => ({}))
        setError(`Created, but ingest failed: ${d.error || 'unknown error'}.`)
        // We still call onCreated so the panel shows the half-finished row
      }

      onCreated(assembly.id)
    } finally {
      setBusy(false)
    }
  }, [templateId, clientId, channelId, ticketId, workspaceId, inputMode, rawText, pieceJson, uploadedFile, strategy, onCreated])

  const tabs: Array<{ id: InputMode; label: string; icon: React.ReactNode }> = useMemo(() => ([
    { id: 'text', label: 'Paste text', icon: <Type size={13} /> },
    { id: 'file', label: 'Upload file', icon: <FileText size={13} /> },
    { id: 'piece', label: 'Pre-built JSON', icon: <Code size={13} /> },
  ]), [])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="mm-modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="mm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assembly-ingest-title"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 720, width: '92vw' }}
      >
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 id="assembly-ingest-title" style={{ margin: 0, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={16} /> New assembly
          </h2>
          <button type="button" className="ghost-button" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </header>

        {loading ? (
          <div className="module-panel-loading"><Loader2 size={20} className="spin" /> Loading workspace data…</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label className="field-label">
                Template *
                <select className="slack-input" value={templateId} onChange={e => setTemplateId(e.target.value)}>
                  <option value="">— Pick a template —</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.kind} v{t.version}, {t.page_size})
                    </option>
                  ))}
                </select>
                {templates.length === 0 && (
                  <span className="doc-muted" style={{ fontSize: 12 }}>
                    No HTML templates yet. Add one in the <strong>HTML Templates</strong> tab first.
                  </span>
                )}
              </label>

              <label className="field-label">
                Client (optional)
                <select className="slack-input" value={clientId} onChange={e => setClientId(e.target.value)}>
                  <option value="">— No client —</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.code ? ` (${c.code})` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-label">
                Deliver to channel (optional)
                <select className="slack-input" value={channelId} onChange={e => setChannelId(e.target.value)}>
                  <option value="">— Don’t auto-post —</option>
                  {channels.map(c => (
                    <option key={c.id} value={c.id}>#{c.display_name || c.name}</option>
                  ))}
                </select>
              </label>

              <label className="field-label">
                Extraction strategy
                <select className="slack-input" value={strategy} onChange={e => setStrategy(e.target.value as typeof strategy)}>
                  <option value="auto">Auto (LLM with regex fallback)</option>
                  <option value="regex">Regex only</option>
                  <option value="llm">LLM only</option>
                </select>
              </label>
            </div>

            {/* Input mode tabs */}
            <div role="tablist" aria-label="Input mode" style={{ display: 'flex', gap: 6, marginTop: 14, marginBottom: 8 }}>
              {tabs.map(t => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={inputMode === t.id}
                  className={`pipeline-filter-pill ${inputMode === t.id ? 'pipeline-filter-pill--active' : ''}`}
                  onClick={() => setInputMode(t.id)}
                >
                  {t.icon}
                  <span style={{ marginLeft: 6 }}>{t.label}</span>
                </button>
              ))}
            </div>

            {inputMode === 'text' && (
              <textarea
                className="slack-input"
                rows={10}
                value={rawText}
                onChange={e => setRawText(e.target.value)}
                placeholder="Paste invoice / quote / receipt / report text…"
                style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
              />
            )}

            {inputMode === 'file' && (
              <div style={{ padding: 14, border: '1px dashed var(--mm-border-subtle)', borderRadius: 8, textAlign: 'center' }}>
                <input
                  type="file"
                  accept=".txt,.csv,.md,.json,.xml,.html,application/pdf,text/plain"
                  onChange={e => setUploadedFile(e.target.files?.[0] || null)}
                />
                {uploadedFile && (
                  <p className="doc-muted" style={{ fontSize: 12, marginTop: 8 }}>
                    Selected: <strong>{uploadedFile.name}</strong> ({(uploadedFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
                <p className="doc-muted" style={{ fontSize: 11, marginTop: 8 }}>
                  Text-based files (TXT, CSV, MD, JSON, HTML) are best. For PDFs/Word, OCR/convert first via the Files tab.
                </p>
              </div>
            )}

            {inputMode === 'piece' && (
              <textarea
                className="slack-input"
                rows={12}
                value={pieceJson}
                onChange={e => setPieceJson(e.target.value)}
                placeholder='{"schema_version": "1", "fields": { ... }, …}'
                style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre' }}
                spellCheck={false}
              />
            )}

            {error && (
              <div className="mm-auth-alert mm-auth-alert--error" role="alert" style={{ marginTop: 10 }}>
                <AlertCircle size={14} /> <span>{error}</span>
              </div>
            )}

            <div className="mm-modal-actions" style={{ marginTop: 14 }}>
              <button type="button" className="ghost-button" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="button" className="slack-button" onClick={() => void submit()} disabled={busy || !templateId}>
                {busy ? (<><Loader2 size={14} className="spin" /> Creating…</>) : (<><Sparkles size={14} /> Create &amp; ingest</>)}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
