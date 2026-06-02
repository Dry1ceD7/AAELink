'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { CheckSquare, Code2, Heading, Pilcrow, AlertCircle, Quote as QuoteIcon, Minus, StickyNote, X, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'

/* ─────────────────────────────────────────────────────────────────────
   CanvasEditor — Slack Canvas equivalent
   • Rich-text collaborative document attached to each channel/DM
   • Supports headings, checklists, code blocks, dividers, embeds
   • Pin action items, meeting notes, and files alongside chat
   ───────────────────────────────────────────────────────────────────── */

interface CanvasBlock {
  id: string
  type: 'heading' | 'paragraph' | 'checklist' | 'code' | 'divider' | 'callout' | 'image' | 'file' | 'mention' | 'quote'
  content: string
  checked?: boolean
  language?: string
  level?: 1 | 2 | 3
  color?: string
}

interface CanvasEditorProps {
  channelId?: string
  channelName: string
  onClose: () => void
}

const BLOCK_TEMPLATES: { type: CanvasBlock['type']; icon: React.ReactNode; label: string }[] = [
  { type: 'heading', icon: <Heading size={14} />, label: 'Heading' },
  { type: 'paragraph', icon: <Pilcrow size={14} />, label: 'Text' },
  { type: 'checklist', icon: <CheckSquare size={14} />, label: 'Checklist' },
  { type: 'code', icon: <Code2 size={14} />, label: 'Code block' },
  { type: 'callout', icon: <AlertCircle size={14} />, label: 'Callout' },
  { type: 'quote', icon: <QuoteIcon size={14} />, label: 'Quote' },
  { type: 'divider', icon: <Minus size={14} />, label: 'Divider' },
]

let blockIdCounter = 0
const makeId = () => `block-${++blockIdCounter}-${Date.now()}`

export default function CanvasEditor({ channelId, channelName, onClose }: CanvasEditorProps) {
  const DEFAULT_BLOCKS: CanvasBlock[] = [
    { id: makeId(), type: 'heading', content: `Canvas for #${channelName}`, level: 1 },
    { id: makeId(), type: 'paragraph', content: 'Add notes, action items, and resources for the team.' },
    { id: makeId(), type: 'divider', content: '' },
    { id: makeId(), type: 'callout', content: 'This canvas is visible to all members of this channel.', color: '#4361EE' },
  ]
  const [blocks, setBlocks] = useState<CanvasBlock[]>(DEFAULT_BLOCKS)
  const [showBlockMenu, setShowBlockMenu] = useState<string | null>(null)
  const [editingBlock, setEditingBlock] = useState<string | null>(null)
  const [lastSaved, setLastSaved] = useState<string>('—')
  const [showShareMenu, setShowShareMenu] = useState(false)
  const [collaborators] = useState([
    { name: 'Admin', avatar: '', status: 'online' },
    { name: 'Sarah Chen', avatar: '', status: 'online' },
  ])

  // ── Persistence (audit §14.1) ─────────────────────────────────────────
  // Load the channel's canvas (if one exists) on mount; create lazily on
  // first save. Debounce saves at 800ms so heavy typing doesn't hammer
  // the API.
  const [canvasId, setCanvasId] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(channelId))
  const [saving, setSaving] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blocksRef = useRef<CanvasBlock[]>(DEFAULT_BLOCKS)
  const skipNextSave = useRef(true) // initial mount load shouldn't trigger a save
  blocksRef.current = blocks

  useEffect(() => {
    if (!channelId) { setLoading(false); return }
    let cancelled = false
    void (async () => {
      try {
        const list = await apiFetch(`/api/docs/canvas?channel_id=${encodeURIComponent(channelId)}&type=channel_canvas`)
        if (!list.ok) return
        const data = (await list.json()) as { canvases?: Array<{ id: string }> }
        const existing = (data.canvases || [])[0]
        if (!existing) return
        // Pull the full canvas — list endpoint doesn't include content_blocks.
        const detail = await apiFetch(`/api/docs/canvas?id=${encodeURIComponent(existing.id)}`)
        if (!detail.ok) return
        const d = (await detail.json()) as { canvas?: { id: string; content_blocks?: CanvasBlock[] } }
        if (cancelled || !d.canvas) return
        setCanvasId(d.canvas.id)
        const fetched = Array.isArray(d.canvas.content_blocks) ? d.canvas.content_blocks : []
        if (fetched.length > 0) {
          // Re-id blocks so the local makeId counter doesn't collide.
          setBlocks(fetched.map(b => ({ ...b, id: b.id || makeId() })))
        }
        setLastSaved(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [channelId])

  const saveNow = useCallback(async () => {
    if (!channelId) return
    setSaving(true)
    try {
      if (!canvasId) {
        // Create the canvas on first save.
        const res = await apiFetch('/api/docs/canvas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `#${channelName} canvas`,
            type: 'channel_canvas',
            channel_id: channelId,
            content_blocks: blocksRef.current,
          }),
        })
        if (res.ok) {
          const data = (await res.json()) as { canvas?: { id: string } }
          if (data.canvas?.id) setCanvasId(data.canvas.id)
        }
      } else {
        await apiFetch('/api/docs/canvas', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            canvas_id: canvasId,
            content_blocks: blocksRef.current,
          }),
        })
      }
      setLastSaved(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    } finally {
      setSaving(false)
    }
  }, [canvasId, channelId, channelName])

  // Debounced auto-save on every blocks change after the initial mount-load.
  useEffect(() => {
    if (skipNextSave.current) { skipNextSave.current = false; return }
    if (!channelId || loading) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void saveNow() }, 800)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [blocks, channelId, loading, saveNow])

  const updateBlock = useCallback((id: string, updates: Partial<CanvasBlock>) => {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, ...updates } : b))
  }, [])

  const addBlockAfter = useCallback((afterId: string, type: CanvasBlock['type']) => {
    const newBlock: CanvasBlock = {
      id: makeId(), type, content: '',
      ...(type === 'checklist' ? { checked: false } : {}),
      ...(type === 'heading' ? { level: 2 } : {}),
      ...(type === 'callout' ? { color: '#4361EE' } : {}),
    }
    setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === afterId)
      const next = [...prev]
      next.splice(idx + 1, 0, newBlock)
      return next
    })
    setShowBlockMenu(null)
    setEditingBlock(newBlock.id)
  }, [])

  const deleteBlock = useCallback((id: string) => {
    setBlocks(prev => prev.filter(b => b.id !== id))
  }, [])

  const moveBlock = useCallback((id: string, direction: 'up' | 'down') => {
    setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === id)
      if ((direction === 'up' && idx <= 0) || (direction === 'down' && idx >= prev.length - 1)) return prev
      const next = [...prev]
      const swap = direction === 'up' ? idx - 1 : idx + 1
      ;[next[idx], next[swap]] = [next[swap], next[idx]]
      return next
    })
  }, [])

  /* ── Render a single block ─────────────────────────── */
  const renderBlock = (block: CanvasBlock) => {
    const isEditing = editingBlock === block.id

    switch (block.type) {
      case 'heading': {
        const level = block.level || 1
        const cls = `canvas-heading canvas-heading--${level}`
        return (
          <div onClick={() => setEditingBlock(block.id)} className="canvas-editable">
            {isEditing ? (
              <input className={`canvas-inline-input ${cls}`}
                value={block.content}
                onChange={e => updateBlock(block.id, { content: e.target.value })}
                onBlur={() => setEditingBlock(null)}
                autoFocus
              />
            ) : (
              <div className={cls}>
                {block.content || <span className="canvas-placeholder">Heading</span>}
              </div>
            )}
          </div>
        )
      }
      case 'paragraph':
        return (
          <div onClick={() => setEditingBlock(block.id)} className="canvas-editable">
            {isEditing ? (
              <textarea className="canvas-inline-input canvas-paragraph"
                value={block.content}
                onChange={e => updateBlock(block.id, { content: e.target.value })}
                onBlur={() => setEditingBlock(null)}
                autoFocus
                rows={Math.max(1, block.content.split('\n').length)}
              />
            ) : (
              <div className="canvas-paragraph">
                {block.content || <span className="canvas-placeholder">Type something…</span>}
              </div>
            )}
          </div>
        )
      case 'checklist':
        return (
          <div className="canvas-checklist">
            <input
              type="checkbox"
              checked={block.checked || false}
              onChange={e => updateBlock(block.id, { checked: e.target.checked })}
              className="canvas-checkbox"
            />
            <div onClick={() => setEditingBlock(block.id)}
              className={`canvas-checklist-text${block.checked ? ' canvas-checklist-text--done' : ''}`}>
              {isEditing ? (
                <input className="canvas-inline-input canvas-paragraph"
                  value={block.content}
                  onChange={e => updateBlock(block.id, { content: e.target.value })}
                  onBlur={() => setEditingBlock(null)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addBlockAfter(block.id, 'checklist')
                    }
                  }}
                  autoFocus
                />
              ) : (
                <span className="canvas-paragraph">
                  {block.content || <span className="canvas-placeholder">To-do item</span>}
                </span>
              )}
            </div>
          </div>
        )
      case 'code':
        return (
          <div className="canvas-code-block">
            {isEditing ? (
              <textarea className="canvas-inline-input canvas-code-input"
                value={block.content}
                onChange={e => updateBlock(block.id, { content: e.target.value })}
                onBlur={() => setEditingBlock(null)}
                autoFocus
              />
            ) : (
              <pre onClick={() => setEditingBlock(block.id)} className="canvas-editable canvas-code-pre">
                {block.content || <span className="canvas-placeholder">Code block</span>}
              </pre>
            )}
          </div>
        )
      case 'callout':
        return (
          <div className="canvas-callout"
            style={{
              background: `${block.color || '#4361EE'}12`,
              borderLeftColor: block.color || '#4361EE',
            }}>
            {isEditing ? (
              <textarea className="canvas-inline-input canvas-callout-input"
                value={block.content}
                onChange={e => updateBlock(block.id, { content: e.target.value })}
                onBlur={() => setEditingBlock(null)}
                autoFocus
                rows={2}
              />
            ) : (
              <div onClick={() => setEditingBlock(block.id)} className="canvas-editable">
                {block.content || <span className="canvas-placeholder">Callout</span>}
              </div>
            )}
          </div>
        )
      case 'quote':
        return (
          <div className="canvas-quote">
            {isEditing ? (
              <textarea className="canvas-inline-input canvas-quote-input"
                value={block.content}
                onChange={e => updateBlock(block.id, { content: e.target.value })}
                onBlur={() => setEditingBlock(null)}
                autoFocus
              />
            ) : (
              <div onClick={() => setEditingBlock(block.id)} className="canvas-editable">
                {block.content || <span className="canvas-placeholder">Quote</span>}
              </div>
            )}
          </div>
        )
      case 'divider':
        return <hr className="canvas-divider" />
      default:
        return null
    }
  }

  return (
    <div className="canvas-editor">
      {/* Toolbar */}
      <div className="canvas-toolbar">
        <div className="canvas-toolbar-left">
          <StickyNote size={16} className="canvas-toolbar-icon" />
          <span className="canvas-toolbar-title">Canvas</span>
          <span className="canvas-toolbar-channel">#{channelName}</span>
        </div>
        <div className="canvas-toolbar-right">
          <div className="canvas-collaborators">
            {collaborators.map((c, i) => (
              <div key={i} className="canvas-collaborator"
                style={{ marginLeft: i > 0 ? -8 : 0, zIndex: collaborators.length - i }}>
                {c.name[0]}
                {c.status === 'online' && <div className="canvas-collaborator-dot" />}
              </div>
            ))}
          </div>
          <span className="canvas-saved-label">
            {saving ? <><Loader2 size={11} className="spin" /> Saving…</> : `Saved at ${lastSaved}`}
          </span>
          <button className="canvas-share-btn" onClick={() => setShowShareMenu(!showShareMenu)}>Share</button>
          <button className="canvas-close-btn" onClick={onClose} aria-label="Close canvas"><X size={18} /></button>
        </div>
      </div>

      {/* Canvas Body */}
      <div className="canvas-body">
        {blocks.map((block, idx) => (
          <div key={block.id} className="canvas-block-wrapper">
            {/* Block hover controls */}
            <div className="canvas-block-controls">
              <button onClick={() => setShowBlockMenu(showBlockMenu === block.id ? null : block.id)}
                title="Add block" className="canvas-block-ctrl-btn">+</button>
              {block.type !== 'divider' && (
                <button onClick={() => deleteBlock(block.id)} title="Delete"
                  className="canvas-block-ctrl-btn">×</button>
              )}
            </div>

            {renderBlock(block)}

            {/* Block menu */}
            {showBlockMenu === block.id && (
              <div className="canvas-block-menu">
                {BLOCK_TEMPLATES.map(t => (
                  <button key={t.type} onClick={() => addBlockAfter(block.id, t.type)}
                    className="canvas-block-menu-item">
                    <span className="canvas-block-menu-icon">{t.icon}</span>
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Add block CTA */}
        <div className="canvas-add-block-wrap">
          <button onClick={() => {
            const lastBlock = blocks[blocks.length - 1]
            if (lastBlock) addBlockAfter(lastBlock.id, 'paragraph')
          }} className="canvas-add-block-btn">
            + Add a block
          </button>
        </div>
      </div>
    </div>
  )
}
