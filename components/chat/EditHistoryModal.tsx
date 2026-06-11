'use client'

import { useEffect, useState } from 'react'
import { Modal } from '@/components/primitives/Modal'
import { apiFetch } from '@/lib/api/apiClient'
import { formatUserTime } from '@/lib/ui/userPreferences'

interface MessageEditView {
  id: string
  editor_id: string | null
  previous_body: string
  edited_at: number
}

interface EditsResponse {
  edits?: MessageEditView[]
  total?: number
  edited?: boolean
}

interface EditHistoryModalProps {
  messageId: string
  open: boolean
  onClose: () => void
}

/**
 * `<EditHistoryModal>` — shows a message's prior versions (edit history),
 * newest first. Opened from the "(edited)" label on a ChatMessage. Each row
 * renders the edit timestamp, the editor, and the body as it was before that
 * edit. Loading, error, and empty states are all handled.
 */
export function EditHistoryModal({ messageId, open, onClose }: EditHistoryModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [edits, setEdits] = useState<MessageEditView[]>([])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(false)
    setEdits([])
    ;(async () => {
      try {
        const res = await apiFetch(`/api/messages/${messageId}/edits`)
        if (!res.ok) {
          if (!cancelled) setError(true)
          return
        }
        const data = (await res.json()) as EditsResponse
        if (!cancelled) setEdits(Array.isArray(data.edits) ? data.edits : [])
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, messageId])

  return (
    <Modal open={open} onClose={onClose} title="Edit history" ariaLabel="Message edit history">
      {loading ? (
        <p className="edit-history-status">Loading edit history…</p>
      ) : error ? (
        <p className="edit-history-status edit-history-status--error">
          Could not load edit history. Please try again.
        </p>
      ) : edits.length === 0 ? (
        <p className="edit-history-status">No edit history for this message.</p>
      ) : (
        <ol className="edit-history-list">
          {edits.map((e) => (
            <li key={e.id} className="edit-history-item">
              <div className="edit-history-meta">
                <span className="edit-history-time">{formatUserTime(new Date(e.edited_at))}</span>
                <span className="edit-history-editor">
                  {e.editor_id ? `Edited by ${e.editor_id.slice(0, 8)}` : 'Editor unknown'}
                </span>
              </div>
              <div className="edit-history-body">{e.previous_body}</div>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  )
}
