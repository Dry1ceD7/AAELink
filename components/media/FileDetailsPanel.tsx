'use client'

import { useCallback, useEffect, useState } from 'react'
import { X, Download, Trash2, Link as LinkIcon, Copy, Loader2, Send, FileText } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { toast } from '@/lib/ui/toast'
import { useConfirm } from '@/components/a11y'

/**
 * FileDetailsPanel — right-pane-stackable detail view for a single file. Wires
 * existing backends: GET /api/files?file_id (metadata), /api/files/preview
 * (thumbnail), /api/files/comments (thread), POST/DELETE comments, DELETE
 * /api/files (soft-delete; owner/admin), POST/DELETE /api/files/:id/public-link.
 * Note: no GET exists for an existing public link, so the share section starts
 * empty and only reflects links minted within this session.
 */

interface FileInfo { id: string; name: string; mimetype: string; size: number; user: string; user_name: string; created: number }
interface FileComment { id: string; user_id: string; comment: string; created_at: number; username?: string | null; nickname?: string | null }

interface Props {
  fileId: string
  /** Current viewer — used to gate delete + comment removal. */
  currentUserId: string
  /** True when the viewer is a platform admin (delete any file). */
  isAdmin?: boolean
  onClose: () => void
  /** Called after a successful delete so the parent can drop the file. */
  onDeleted?: (fileId: string) => void
}

const JSON_HEADERS = { 'content-type': 'application/json' }
const DANGER = '#e01e5a'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function relativeDate(ms: number): string {
  if (!ms) return ''
  const min = Math.round((Date.now() - ms) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day}d ago`
  return new Date(ms).toLocaleDateString()
}

const PANEL = { display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--mm-main-bg)', color: 'var(--mm-text)' } as const

export function FileDetailsPanel({ fileId, currentUserId, isAdmin = false, onClose, onDeleted }: Props) {
  const { confirm, confirmDialog } = useConfirm()
  const [info, setInfo] = useState<FileInfo | null>(null)
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  const [comments, setComments] = useState<FileComment[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [shareToken, setShareToken] = useState('')

  const loadComments = useCallback(async () => {
    const res = await apiFetch(`/api/files/comments?file_id=${encodeURIComponent(fileId)}`)
    if (!res.ok) return
    const data = (await res.json().catch(() => ({}))) as { comments?: FileComment[] }
    setComments(data.comments || [])
  }, [fileId])

  useEffect(() => {
    let cancelled = false
    setLoading(true); setShareToken('')
    void (async () => {
      const [infoRes, prevRes] = await Promise.all([
        apiFetch(`/api/files?file_id=${encodeURIComponent(fileId)}`),
        apiFetch(`/api/files/preview?file_id=${encodeURIComponent(fileId)}`),
      ])
      if (cancelled) return
      if (infoRes.ok) {
        const d = (await infoRes.json().catch(() => ({}))) as { file?: FileInfo }
        if (d.file) setInfo(d.file)
      } else { toast.error('Could not load file details') }
      if (prevRes.ok) {
        const d = (await prevRes.json().catch(() => ({}))) as { preview?: { thumbnail_url: string | null } }
        setThumbUrl(d.preview?.thumbnail_url || null)
      }
      await loadComments()
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [fileId, loadComments])

  const canDelete = !!info && (info.user === currentUserId || isAdmin)

  const handleDelete = useCallback(async () => {
    if (!info) return
    if (!(await confirm({ title: 'Delete file', message: `Delete "${info.name}"? This cannot be undone.`, danger: true, confirmLabel: 'Delete' }))) return
    const res = await apiFetch('/api/files', { method: 'DELETE', headers: JSON_HEADERS, body: JSON.stringify({ file_id: fileId }) })
    if (res.ok) { toast.success('File deleted'); onDeleted?.(fileId); onClose() }
    else {
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      toast.error(d.error === 'forbidden' ? 'You cannot delete this file' : 'Delete failed')
    }
  }, [confirm, fileId, info, onClose, onDeleted])

  const addComment = useCallback(async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    const res = await apiFetch('/api/files/comments', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ action: 'add', file_id: fileId, comment: text }) })
    setSending(false)
    if (res.ok) { setDraft(''); await loadComments() } else toast.error('Could not post comment')
  }, [draft, fileId, loadComments, sending])

  const deleteComment = useCallback(async (commentId: string) => {
    const res = await apiFetch('/api/files/comments', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ action: 'delete', file_id: fileId, comment_id: commentId }) })
    if (res.ok) await loadComments(); else toast.error('Could not delete comment')
  }, [fileId, loadComments])

  const shareUrl = shareToken ? `${typeof window !== 'undefined' ? window.location.origin : ''}/api/files/public/${shareToken}` : ''

  const createShare = useCallback(async () => {
    const res = await apiFetch(`/api/files/${encodeURIComponent(fileId)}/public-link`, { method: 'POST' })
    const d = (await res.json().catch(() => ({}))) as { token?: string; error?: string }
    if (res.ok && d.token) { setShareToken(d.token); toast.success('Public link created') }
    else toast.error(d.error === 'sharing_disabled' ? 'External sharing is disabled' : 'Could not create link')
  }, [fileId])

  const revokeShare = useCallback(async () => {
    const res = await apiFetch(`/api/files/${encodeURIComponent(fileId)}/public-link`, { method: 'DELETE' })
    if (res.ok) { setShareToken(''); toast.success('Link revoked') } else toast.error('Could not revoke link')
  }, [fileId])

  const copyLink = useCallback(() => {
    if (!shareUrl) return
    void navigator.clipboard.writeText(shareUrl).then(() => toast.success('Link copied')).catch(() => toast.error('Copy failed'))
  }, [shareUrl])

  const meta: ReadonlyArray<readonly [string, string]> = info ? [
    ['Uploader', info.user_name || info.user],
    ['Date', relativeDate(info.created)],
    ['Size', formatSize(info.size)],
    ['Type', info.mimetype.split('/').pop()?.toUpperCase() || ''],
  ] : []

  return (
    <div style={PANEL}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--mm-border)' }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>File details</h2>
        <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}><X size={18} /></button>
      </div>
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60, opacity: 0.5 }}>
          <Loader2 size={28} style={{ animation: 'spin 1s linear infinite' }} />
          <span style={{ fontSize: 13, marginTop: 8 }}>Loading…</span>
        </div>
      ) : !info ? (
        <div style={{ padding: 40, textAlign: 'center', opacity: 0.6, fontSize: 14 }}>File not found</div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
          <div style={{ width: '100%', height: 160, borderRadius: 10, border: '1px solid var(--mm-border)', background: 'var(--mm-hover-bg)', display: 'grid', placeItems: 'center', overflow: 'hidden', marginBottom: 16 }}>
            {thumbUrl ? <img src={thumbUrl} alt={info.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} loading="lazy" /> : <FileText size={40} style={{ opacity: 0.4 }} />}
          </div>
          <div style={{ display: 'grid', gap: 10, marginBottom: 18 }}>
            <div style={{ fontSize: 15, fontWeight: 700, wordBreak: 'break-word' }}>{info.name}</div>
            {meta.map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, opacity: 0.55 }}>{label}</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{value}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
            <a href={`/api/files/${fileId}/download`} target="_blank" rel="noopener noreferrer" download={info.name} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--mm-border)', color: 'var(--mm-text)', textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>
              <Download size={14} /> Download
            </a>
            {canDelete && (
              <button type="button" onClick={handleDelete} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 14px', borderRadius: 8, border: `1px solid ${DANGER}`, background: 'none', color: DANGER, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
          <div style={{ marginBottom: 18, padding: 12, borderRadius: 10, border: '1px solid var(--mm-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, marginBottom: 8 }}><LinkIcon size={14} /> Public link</div>
            {shareToken ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input readOnly value={shareUrl} style={{ flex: 1, padding: '7px 10px', borderRadius: 6, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 12, boxSizing: 'border-box' }} />
                  <button type="button" onClick={copyLink} aria-label="Copy link" style={{ padding: '0 10px', borderRadius: 6, border: '1px solid var(--mm-border)', background: 'var(--mm-hover-bg)', color: 'var(--mm-text)', cursor: 'pointer' }}><Copy size={14} /></button>
                </div>
                <button type="button" onClick={revokeShare} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: DANGER, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Revoke link</button>
              </div>
            ) : (
              <button type="button" onClick={createShare} style={{ padding: '7px 12px', borderRadius: 6, border: '1px solid var(--mm-border)', background: 'var(--mm-hover-bg)', color: 'var(--mm-text)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Create public link</button>
            )}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Comments ({comments.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
            {comments.length === 0 && <div style={{ fontSize: 12, opacity: 0.5 }}>No comments yet.</div>}
            {comments.map(c => (
              <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{c.nickname || c.username || c.user_id}</span>
                  <span style={{ fontSize: 11, opacity: 0.5 }}>{relativeDate(c.created_at)}</span>
                  {(c.user_id === currentUserId || isAdmin) && (
                    <button type="button" onClick={() => deleteComment(c.id)} aria-label="Delete comment" style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--mm-muted)', cursor: 'pointer' }}><Trash2 size={12} /></button>
                  )}
                </div>
                <div style={{ fontSize: 13, opacity: 0.9, wordBreak: 'break-word' }}>{c.comment}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void addComment() } }} placeholder="Add a comment…" style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            <button type="button" onClick={() => void addComment()} disabled={!draft.trim() || sending} aria-label="Post comment" style={{ padding: '0 12px', borderRadius: 8, border: 'none', background: '#06b6d4', color: '#fff', cursor: draft.trim() && !sending ? 'pointer' : 'default', opacity: draft.trim() && !sending ? 1 : 0.5, display: 'grid', placeItems: 'center' }}>
              {sending ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />}
            </button>
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  )
}
