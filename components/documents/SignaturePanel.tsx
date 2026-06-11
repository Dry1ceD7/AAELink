'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PenTool, Users, CheckCircle, Clock, AlertCircle, Send,
  X, RotateCcw, ChevronDown
} from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'

// ── Types ───────────────────────────────────────────────────────────────────

interface SignatureRecord {
  id: string
  document_id: string
  signer_id: string
  signing_order: number
  status: 'pending' | 'signed' | 'declined'
  signer_username?: string
  signer_avatar?: string
  signer_first_name?: string
  signer_last_name?: string
  signed_at: number
  created_at: number
}

interface SignatureSummary {
  total: number
  signed: number
  pending: number
  all_signed: boolean
  next_signer_id: string | null
}

// ── Signature Pad (Canvas-based) ────────────────────────────────────────────

function SignaturePad({
  onSign,
  onCancel,
  busy,
}: {
  onSign: (base64Png: string) => void
  onCancel: () => void
  busy: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasContent, setHasContent] = useState(false)

  const getCtx = () => canvasRef.current?.getContext('2d') ?? null

  const getPos = (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    if ('touches' in e) {
      const touch = e.touches[0]
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top }
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top }
  }

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    const ctx = getCtx()
    if (!ctx) return
    const pos = getPos(e)
    setIsDrawing(true)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
  }

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return
    const ctx = getCtx()
    if (!ctx) return
    const pos = getPos(e)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1a1a2e'
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    setHasContent(true)
  }

  const endDraw = () => {
    setIsDrawing(false)
  }

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = getCtx()
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasContent(false)
  }

  const submit = () => {
    const canvas = canvasRef.current
    if (!canvas || !hasContent) return
    const dataUrl = canvas.toDataURL('image/png')
    // Extract base64 from data URL
    const base64 = dataUrl.split(',')[1]
    if (base64) onSign(base64)
  }

  // Draw signature guideline
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    // Draw baseline guide
    ctx.save()
    ctx.strokeStyle = '#e5e7eb'
    ctx.lineWidth = 1
    ctx.setLineDash([6, 4])
    ctx.beginPath()
    ctx.moveTo(20, canvas.height - 40)
    ctx.lineTo(canvas.width - 20, canvas.height - 40)
    ctx.stroke()
    ctx.restore()
    // Label
    ctx.save()
    ctx.fillStyle = '#9ca3af'
    ctx.font = '12px system-ui, sans-serif'
    ctx.fillText('Sign above this line', 20, canvas.height - 20)
    ctx.restore()
  }, [])

  return (
    <div className="sigpad-container">
      <p className="sigpad-label">Draw your signature below</p>
      <div className="sigpad-canvas-wrap">
        <canvas
          ref={canvasRef}
          width={460}
          height={180}
          className="sigpad-canvas"
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
      </div>
      <div className="sigpad-actions">
        <button type="button" className="ghost-button" onClick={clear} disabled={busy}>
          <RotateCcw size={14} /> Clear
        </button>
        <div style={{ flex: 1 }} />
        <button type="button" className="ghost-button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="slack-button"
          disabled={!hasContent || busy}
          onClick={submit}
        >
          {busy ? 'Signing…' : 'Apply Signature'}
        </button>
      </div>
    </div>
  )
}

// ── Signer Selector ─────────────────────────────────────────────────────────

function SignerSelector({
  documentId,
  workspaceId,
  onRequestSent,
}: {
  documentId: string
  workspaceId: string
  onRequestSent: () => void
}) {
  const [searchText, setSearchText] = useState('')
  const [results, setResults] = useState<{ id: string; username: string; first_name?: string; last_name?: string; avatar_url?: string }[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Search users
  useEffect(() => {
    if (searchText.length < 2) { setResults([]); return }
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/search/users?q=${encodeURIComponent(searchText)}&workspace_id=${encodeURIComponent(workspaceId)}`)
        if (res.ok) {
          const data = await res.json() as { users?: typeof results }
          setResults(data.users ?? [])
        }
      } catch { /* ignore */ }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchText, workspaceId])

  const toggleUser = (userId: string) => {
    setSelected(prev =>
      prev.includes(userId) ? prev.filter(u => u !== userId) : [...prev, userId]
    )
  }

  const sendRequest = async () => {
    if (selected.length === 0) return
    setBusy(true)
    setError('')
    try {
      const res = await apiFetch(
        `/api/documents/${encodeURIComponent(documentId)}/signatures`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'request', signer_ids: selected }),
        }
      )
      if (res.ok) {
        setSelected([])
        setSearchText('')
        onRequestSent()
      } else {
        const data = await res.json().catch(() => ({})) as { error?: string }
        setError(data.error || 'Failed to send signature request')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sig-selector">
      <input
        type="text"
        className="sig-selector-input"
        placeholder="Search users to request signature…"
        value={searchText}
        onChange={e => setSearchText(e.target.value)}
      />

      {results.length > 0 && (
        <div className="sig-selector-results">
          {results.map(u => (
            <button
              key={u.id}
              type="button"
              className={`sig-selector-user${selected.includes(u.id) ? ' sig-selector-user--selected' : ''}`}
              onClick={() => toggleUser(u.id)}
            >
              <span className="sig-selector-avatar">
                {u.avatar_url
                  ? <img src={u.avatar_url} alt="" width={24} height={24} />
                  : <span>{(u.first_name || u.username || '?')[0].toUpperCase()}</span>
                }
              </span>
              <span className="sig-selector-name">
                {u.first_name && u.last_name ? `${u.first_name} ${u.last_name}` : u.username}
              </span>
              {selected.includes(u.id) && <CheckCircle size={14} className="sig-selector-check" />}
            </button>
          ))}
        </div>
      )}

      {selected.length > 0 && (
        <div className="sig-selector-footer">
          <span className="sig-selector-count">{selected.length} signer{selected.length > 1 ? 's' : ''} selected</span>
          <button type="button" className="slack-button" onClick={sendRequest} disabled={busy}>
            <Send size={14} /> {busy ? 'Sending…' : 'Request Signatures'}
          </button>
        </div>
      )}

      {error && <p className="sig-selector-error">{error}</p>}
    </div>
  )
}

// ── Main Signature Panel ────────────────────────────────────────────────────

interface SignaturePanelProps {
  documentId: string
  workspaceId: string
  open: boolean
  onClose: () => void
  currentUserId: string
}

export function SignaturePanel({
  documentId,
  workspaceId,
  open,
  onClose,
  currentUserId,
}: SignaturePanelProps) {
  const [signatures, setSignatures] = useState<SignatureRecord[]>([])
  const [summary, setSummary] = useState<SignatureSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [showPad, setShowPad] = useState(false)
  const [showRequest, setShowRequest] = useState(false)
  const [signBusy, setSignBusy] = useState(false)

  const loadSignatures = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch(
        `/api/documents/${encodeURIComponent(documentId)}/signatures`
      )
      if (res.ok) {
        const data = await res.json() as {
          signatures?: SignatureRecord[]
          summary?: SignatureSummary
        }
        setSignatures(data.signatures ?? [])
        setSummary(data.summary ?? null)
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [documentId])

  useEffect(() => {
    if (open) void loadSignatures()
  }, [open, loadSignatures])

  const submitSignature = useCallback(async (base64: string) => {
    setSignBusy(true)
    try {
      const res = await apiFetch(
        `/api/documents/${encodeURIComponent(documentId)}/signatures`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'sign', signature_data: base64 }),
        }
      )
      if (res.ok) {
        setShowPad(false)
        void loadSignatures()
      }
    } catch { /* ignore */ }
    setSignBusy(false)
  }, [documentId, loadSignatures])

  if (!open) return null

  const hasPending = signatures.some(
    s => s.signer_id === currentUserId && s.status === 'pending'
  )

  return (
    <div className="sig-panel">
      <div className="sig-panel-header">
        <h3><PenTool size={16} /> Signatures</h3>
        <button type="button" className="mm-icon-btn" onClick={onClose} title="Close">
          <X size={16} />
        </button>
      </div>

      {/* Summary bar */}
      {summary && (
        <div className="sig-summary">
          <div className={`sig-summary-badge${summary.all_signed ? ' sig-summary-badge--complete' : ''}`}>
            {summary.all_signed ? (
              <><CheckCircle size={14} /> All signed</>
            ) : (
              <><Clock size={14} /> {summary.signed}/{summary.total} signed</>
            )}
          </div>
          {hasPending && (
            <button type="button" className="slack-button" onClick={() => setShowPad(true)}>
              <PenTool size={14} /> Sign Now
            </button>
          )}
        </div>
      )}

      {/* Signature pad */}
      {showPad && (
        <SignaturePad
          onSign={submitSignature}
          onCancel={() => setShowPad(false)}
          busy={signBusy}
        />
      )}

      {/* Signers list */}
      <div className="sig-panel-list">
        {loading ? (
          <p className="sig-panel-empty">Loading…</p>
        ) : signatures.length === 0 ? (
          <div className="sig-panel-empty">
            <p>No signature requests yet.</p>
            <button type="button" className="slack-button" onClick={() => setShowRequest(true)}>
              <Users size={14} /> Request Signatures
            </button>
          </div>
        ) : (
          <>
            {signatures.map(s => (
              <div key={s.id} className={`sig-signer-row sig-signer-row--${s.status}`}>
                <div className="sig-signer-order">{s.signing_order}</div>
                <div className="sig-signer-info">
                  <span className="sig-signer-name">
                    {s.signer_first_name && s.signer_last_name
                      ? `${s.signer_first_name} ${s.signer_last_name}`
                      : s.signer_username || 'Unknown'}
                  </span>
                  {s.signer_username && (
                    <span className="sig-signer-username">@{s.signer_username}</span>
                  )}
                </div>
                <div className="sig-signer-status">
                  {s.status === 'signed' ? (
                    <span className="sig-badge sig-badge--signed">
                      <CheckCircle size={12} /> Signed
                    </span>
                  ) : s.status === 'pending' ? (
                    <span className="sig-badge sig-badge--pending">
                      <Clock size={12} /> Pending
                    </span>
                  ) : (
                    <span className="sig-badge sig-badge--declined">
                      <AlertCircle size={12} /> Declined
                    </span>
                  )}
                  {s.signed_at > 0 && (
                    <span className="sig-signer-date">
                      {new Date(s.signed_at).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            ))}

            <button
              type="button"
              className="ghost-button"
              style={{ marginTop: 8, width: '100%' }}
              onClick={() => setShowRequest(o => !o)}
            >
              <Users size={14} /> {showRequest ? 'Hide' : 'Add More Signers'}
            </button>
          </>
        )}
      </div>

      {/* Signer selector */}
      {showRequest && (
        <SignerSelector
          documentId={documentId}
          workspaceId={workspaceId}
          onRequestSent={() => {
            setShowRequest(false)
            void loadSignatures()
          }}
        />
      )}
    </div>
  )
}
