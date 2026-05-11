'use client'

import { useState } from 'react'
import { apiFetch } from '@/lib/apiClient'

interface CreateChannelModalProps {
  open: boolean
  workspaceId: string
  onClose: () => void
  onCreated: (channel: { id: string; name: string; display_name: string; type: string }) => void
}

export function CreateChannelModal({ open, workspaceId, onClose, onCreated }: CreateChannelModalProps) {
  const [display, setDisplay] = useState('')
  const [slug, setSlug] = useState('')
  const [purpose, setPurpose] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  const reset = () => { setDisplay(''); setSlug(''); setPurpose(''); setIsPrivate(false); setError('') }

  const handleCreate = async () => {
    setError('')
    const display_name = display.trim()
    if (!display_name || !workspaceId) { setError('Enter a channel name.'); return }
    setBusy(true)
    const res = await apiFetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: workspaceId,
        display_name,
        name: slug.trim() || undefined,
        purpose: purpose.trim() || undefined,
        type: isPrivate ? 'P' : 'O'
      })
    })
    setBusy(false)
    if (!res.ok) { setError('Could not create channel.'); return }
    const data = (await res.json()) as { channel?: { id: string; name: string; display_name: string; type: string } }
    reset()
    if (data?.channel) onCreated(data.channel)
    onClose()
  }

  return (
    <div className="modal-overlay" role="presentation" onClick={() => !busy && onClose()}>
      <div className="modal-panel slack-card" role="dialog" aria-modal="true"
        aria-labelledby="new-channel-title" onClick={e => e.stopPropagation()}>
        <h2 id="new-channel-title" style={{ marginTop: 0 }}>Create channel</h2>
        <label className="field-label">Display name
          <input className="slack-input" value={display}
            onChange={e => setDisplay(e.target.value)} placeholder="e.g. Engineering" />
        </label>
        <label className="field-label" style={{ marginTop: 12 }}>URL name (optional)
          <input className="slack-input" value={slug}
            onChange={e => setSlug(e.target.value)} placeholder="Auto from display name if empty" />
        </label>
        <label className="field-label" style={{ marginTop: 12 }}>Purpose (optional)
          <textarea className="slack-input" value={purpose}
            onChange={e => setPurpose(e.target.value)}
            placeholder="What is this channel about?"
            rows={2}
            style={{ resize: 'vertical', minHeight: 48, fontFamily: 'inherit' }} />
        </label>
        <label className="field-label" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={isPrivate} onChange={e => setIsPrivate(e.target.checked)} />
          <span>Make private (invite only)</span>
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={() => !busy && onClose()}>Cancel</button>
          <button type="button" className="slack-button" disabled={busy}
            onClick={() => void handleCreate()}>{busy ? 'Creating…' : 'Create'}</button>
        </div>
      </div>
    </div>
  )
}
