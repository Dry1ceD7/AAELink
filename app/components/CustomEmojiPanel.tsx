'use client'

import { memo, useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, X, Upload, SmilePlus, Search } from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'

interface CustomEmoji {
  id: string
  name: string
  url: string
  creator_id: string
  created_at: number
}

interface Props {
  open: boolean
  onClose: () => void
  workspaceId: string
}

/**
 * CustomEmojiPanel — Slack-style custom emoji management.
 * Upload new emoji, view existing ones, search, and delete.
 */
export const CustomEmojiPanel = memo(function CustomEmojiPanel({ open, onClose, workspaceId }: Props) {
  const [emojis, setEmojis] = useState<CustomEmoji[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [uploading, setUploading] = useState(false)
  const [newName, setNewName] = useState('')
  const [newFile, setNewFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)

  // Load custom emojis
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const res = await apiFetch(`/api/emoji?workspace_id=${encodeURIComponent(workspaceId)}`)
        if (res.ok && !cancelled) {
          const data = await res.json() as { emojis?: CustomEmoji[] }
          setEmojis(data.emojis ?? [])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, workspaceId])

  const filtered = query.trim()
    ? emojis.filter(e => e.name.toLowerCase().includes(query.toLowerCase()))
    : emojis

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setNewFile(file)
    // Generate preview
    const reader = new FileReader()
    reader.onload = () => setPreview(reader.result as string)
    reader.readAsDataURL(file)
    // Auto-fill name from filename
    if (!newName) {
      const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()
      setNewName(baseName)
    }
  }, [newName])

  const handleUpload = useCallback(async () => {
    if (!newFile || !newName.trim()) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', newFile)
      formData.append('name', newName.trim().toLowerCase().replace(/\s+/g, '_'))
      formData.append('workspace_id', workspaceId)
      const res = await apiFetch('/api/emoji', { method: 'POST', body: formData })
      if (res.ok) {
        const data = await res.json() as { emoji?: CustomEmoji }
        if (data.emoji) {
          setEmojis(prev => [data.emoji!, ...prev])
        }
        setNewName('')
        setNewFile(null)
        setPreview(null)
        setShowUpload(false)
      }
    } finally {
      setUploading(false)
    }
  }, [newFile, newName, workspaceId])

  const handleDelete = useCallback(async (emojiId: string) => {
    const res = await apiFetch(`/api/emoji/${emojiId}`, { method: 'DELETE' })
    if (res.ok) {
      setEmojis(prev => prev.filter(e => e.id !== emojiId))
    }
  }, [])

  if (!open) return null

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div className="modal-panel slack-card custom-emoji-panel" role="dialog" aria-modal="true"
        onClick={e => e.stopPropagation()} style={{ maxWidth: 560, width: '90vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
            <SmilePlus size={20} /> Custom Emoji
          </h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="slack-button" onClick={() => setShowUpload(v => !v)}
              style={{ fontSize: 12, padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Plus size={14} /> Add Emoji
            </button>
            <button type="button" className="mm-icon-btn" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Upload section */}
        {showUpload && (
          <div className="custom-emoji-upload">
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div className="custom-emoji-preview-box">
                {preview ? (
                  <img src={preview} alt="Preview" style={{ width: 48, height: 48, objectFit: 'contain', borderRadius: 4 }} />
                ) : (
                  <Upload size={24} style={{ color: 'var(--mm-muted)' }} />
                )}
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label className="slack-input-wrapper" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="file" accept="image/png,image/gif,image/jpeg,image/webp" onChange={handleFileChange}
                    style={{ display: 'none' }} />
                  <span className="slack-button" style={{ fontSize: 12, padding: '4px 12px' }}>Choose Image</span>
                  <span style={{ fontSize: 12, color: 'var(--mm-muted)' }}>
                    {newFile ? newFile.name : 'PNG, GIF, JPEG, or WebP. Max 256 KB.'}
                  </span>
                </label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 13 }}>:</span>
                  <input
                    className="slack-input"
                    type="text"
                    placeholder="emoji_name"
                    value={newName}
                    onChange={e => setNewName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                    style={{ flex: 1, fontSize: 13, padding: '4px 8px' }}
                  />
                  <span style={{ fontSize: 13 }}>:</span>
                  <button
                    type="button"
                    className="slack-button"
                    disabled={!newFile || !newName.trim() || uploading}
                    onClick={() => void handleUpload()}
                    style={{ fontSize: 12, padding: '4px 16px' }}
                  >
                    {uploading ? 'Uploading…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="channel-browse-search" style={{ marginBottom: 8 }}>
          <Search size={16} style={{ color: 'var(--mm-muted)', flexShrink: 0 }} />
          <input
            className="slack-input"
            type="text"
            placeholder="Search custom emoji…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ border: 'none', background: 'none', flex: 1, padding: '6px 0' }}
          />
        </div>

        {/* Emoji grid */}
        <div className="custom-emoji-grid" style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <p style={{ textAlign: 'center', color: 'var(--mm-muted)', padding: '24px 0' }}>Loading emoji…</p>
          ) : filtered.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--mm-muted)', padding: '24px 0' }}>
              {query ? 'No emoji match your search.' : 'No custom emoji yet. Click "Add Emoji" to create one!'}
            </p>
          ) : (
            <div className="custom-emoji-list">
              {filtered.map(emoji => (
                <div key={emoji.id} className="custom-emoji-item">
                  <img src={emoji.url} alt={emoji.name} className="custom-emoji-img" />
                  <span className="custom-emoji-name">:{emoji.name}:</span>
                  <button
                    type="button"
                    className="mm-icon-btn custom-emoji-delete"
                    title="Delete emoji"
                    aria-label={`Delete :${emoji.name}:`}
                    onClick={() => void handleDelete(emoji.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
