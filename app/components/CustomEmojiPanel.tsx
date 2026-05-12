'use client'

import { useCallback, useEffect, useState } from 'react'
import { SmilePlus, Upload, X, Plus, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'
import { useConfirm } from '@/app/components/a11y'

/* ── Custom Emoji Manager — Upload & manage workspace emojis ─────── */

interface CustomEmoji {
  id: string
  name: string
  image_url?: string
  alias_for?: string
  creator_username?: string
  created_by: string
  created_at: number | string
}

export default function CustomEmojiPanel({ onClose }: { onClose: () => void }) {
  const { confirm, confirmDialog } = useConfirm()
  const [emojis, setEmojis] = useState<CustomEmoji[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [sortBy, setSortBy] = useState<'name' | 'recent'>('name')
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Get the user's current workspace from localStorage or default
      const wsId = typeof window !== 'undefined' ? localStorage.getItem('aaelink_workspace_id') || '' : ''
      if (!wsId) { setLoading(false); return }
      const res = await apiFetch(`/api/emoji?workspace_id=${wsId}`)
      if (res.ok) {
        const data = await res.json() as { emoji?: CustomEmoji[] }
        setEmojis(data.emoji || [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const filtered = emojis
    .filter(e => !search || e.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      // recent — sort by created_at descending
      const aT = typeof a.created_at === 'number' ? a.created_at : Date.parse(String(a.created_at)) || 0
      const bT = typeof b.created_at === 'number' ? b.created_at : Date.parse(String(b.created_at)) || 0
      return bT - aT
    })

  const deleteEmoji = async (id: string) => {
    if (!(await confirm({ title: 'Remove emoji', message: 'Remove this custom emoji?', danger: true, confirmLabel: 'Remove' }))) return
    const wsId = typeof window !== 'undefined' ? localStorage.getItem('aaelink_workspace_id') || '' : ''
    await apiFetch('/api/emoji', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji_id: id, workspace_id: wsId }),
    })
    setEmojis(prev => prev.filter(e => e.id !== id))
  }

  const uploadEmoji = async () => {
    if (!newName) return
    const wsId = typeof window !== 'undefined' ? localStorage.getItem('aaelink_workspace_id') || '' : ''
    await apiFetch('/api/emoji', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newName.replace(/^:|:$/g, ''),
        image_url: newUrl || undefined,
        workspace_id: wsId,
      }),
    })
    setShowUpload(false)
    setNewName('')
    setNewUrl('')
    void load()
  }

  return (
    <>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--mm-main-bg)', color: 'var(--mm-text)' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #f59e0b, #f97316)', display: 'grid', placeItems: 'center' }}><SmilePlus size={18} color="#fff" /></div>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Custom Emoji</h2>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>{emojis.length} custom emoji in your workspace</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowUpload(true)} style={{ background: 'linear-gradient(135deg, #f59e0b, #f97316)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}><Plus size={13} /> Add Emoji</button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}><X size={18} /></button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search emoji…" style={{ flex: 1, padding: '9px 14px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13, outline: 'none' }} />
          <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} style={{ padding: '9px 10px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 12 }}>
            <option value="name">Alphabetical</option>
            <option value="recent">Recent</option>
          </select>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--mm-muted)' }}><Loader2 size={20} className="spin" /> Loading emoji…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, opacity: 0.5, fontSize: 13 }}>{search ? 'No emoji match your search.' : 'No custom emoji yet. Add one to get started!'}</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {filtered.map(emoji => (
              <div key={emoji.id} style={{ padding: 14, borderRadius: 12, border: '1px solid var(--mm-border)', display: 'flex', alignItems: 'center', gap: 12 }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--mm-hover-bg)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {emoji.image_url ? (
                  <img src={emoji.image_url} alt={emoji.name} width={32} height={32} style={{ borderRadius: 4, objectFit: 'contain' }} />
                ) : (
                  <span style={{ fontSize: 32, width: 32, textAlign: 'center' }}>😀</span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>:{emoji.name}:</div>
                  <div style={{ fontSize: 11, opacity: 0.5 }}>by {emoji.creator_username || emoji.created_by}</div>
                  {emoji.alias_for && <div style={{ fontSize: 10, opacity: 0.4 }}>alias for :{emoji.alias_for}:</div>}
                </div>
                <button onClick={() => void deleteEmoji(emoji.id)} title="Remove" style={{ background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', color: 'var(--mm-muted)', padding: 4 }}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showUpload && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000, display: 'grid', placeItems: 'center' }} onClick={() => setShowUpload(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--mm-main-bg)', borderRadius: 16, padding: 24, width: 400, boxShadow: '0 24px 80px rgba(0,0,0,0.3)' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 800 }}>Add Custom Emoji</h3>
            <div style={{ marginBottom: 16, padding: 40, borderRadius: 12, border: '2px dashed var(--mm-border)', textAlign: 'center', cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}><Upload size={36} style={{ opacity: 0.5 }} /></div>
              <p style={{ margin: 0, fontSize: 13, opacity: 0.6 }}>Drop image here or click to upload</p>
              <p style={{ margin: '4px 0 0', fontSize: 11, opacity: 0.4 }}>PNG, GIF, JPEG · Max 128KB</p>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>Emoji Name</label>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder=":my-emoji:" style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>Image URL (optional)</label>
              <input value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="https://..." style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowUpload(false)} style={{ background: 'var(--mm-hover-bg)', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', color: 'var(--mm-text)', fontSize: 13 }}>Cancel</button>
              <button onClick={() => void uploadEmoji()} style={{ background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: newName ? 1 : 0.5 }}>Upload</button>
            </div>
          </div>
        </div>
      )}
    </div>
    {confirmDialog}
    </>
  )
}
