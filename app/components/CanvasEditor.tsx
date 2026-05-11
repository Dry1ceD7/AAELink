'use client'

import { useState, useRef, useCallback } from 'react'
import { CheckSquare, Code2, Heading, Pilcrow, AlertCircle, Quote as QuoteIcon, Minus, Lightbulb, StickyNote, Trash2, X } from 'lucide-react'

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
  isFullScreen?: boolean
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

export default function CanvasEditor({ channelId, channelName, onClose, isFullScreen }: CanvasEditorProps) {
  const [blocks, setBlocks] = useState<CanvasBlock[]>([
    { id: makeId(), type: 'heading', content: `Canvas for #${channelName}`, level: 1 },
    { id: makeId(), type: 'paragraph', content: 'Add notes, action items, and resources for the team.' },
    { id: makeId(), type: 'divider', content: '' },
    { id: makeId(), type: 'checklist', content: 'Review Q3 design mockups', checked: false },
    { id: makeId(), type: 'checklist', content: 'Share budget spreadsheet', checked: true },
    { id: makeId(), type: 'checklist', content: 'Schedule follow-up with engineering', checked: false },
    { id: makeId(), type: 'divider', content: '' },
    { id: makeId(), type: 'callout', content: 'This canvas is visible to all members of this channel.', color: '#4361EE' },
  ])
  const [showBlockMenu, setShowBlockMenu] = useState<string | null>(null)
  const [editingBlock, setEditingBlock] = useState<string | null>(null)
  const [lastSaved, setLastSaved] = useState<string>(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
  const [showShareMenu, setShowShareMenu] = useState(false)
  const [collaborators] = useState([
    { name: 'Admin', avatar: '', status: 'online' },
    { name: 'Sarah Chen', avatar: '', status: 'online' },
  ])

  const updateBlock = useCallback((id: string, updates: Partial<CanvasBlock>) => {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, ...updates } : b))
    setLastSaved(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
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
    const commonInput = {
      style: {
        width: '100%', border: 'none', outline: 'none', resize: 'none' as const,
        background: 'transparent', color: 'inherit', fontFamily: 'inherit',
        fontSize: 'inherit', lineHeight: 'inherit', padding: 0,
      },
    }

    switch (block.type) {
      case 'heading': {
        const sizes = { 1: 24, 2: 20, 3: 16 }
        const sz = sizes[block.level || 1]
        return (
          <div onClick={() => setEditingBlock(block.id)} style={{ cursor: 'text' }}>
            {isEditing ? (
              <input {...commonInput}
                style={{ ...commonInput.style, fontSize: sz, fontWeight: 700, lineHeight: 1.3 }}
                value={block.content}
                onChange={e => updateBlock(block.id, { content: e.target.value })}
                onBlur={() => setEditingBlock(null)}
                autoFocus
              />
            ) : (
              <div style={{ fontSize: sz, fontWeight: 700, lineHeight: 1.3, minHeight: sz + 8 }}>
                {block.content || <span style={{ opacity: 0.3 }}>Heading</span>}
              </div>
            )}
          </div>
        )
      }
      case 'paragraph':
        return (
          <div onClick={() => setEditingBlock(block.id)} style={{ cursor: 'text' }}>
            {isEditing ? (
              <textarea {...commonInput}
                style={{ ...commonInput.style, fontSize: 15, lineHeight: 1.6, minHeight: 24 }}
                value={block.content}
                onChange={e => updateBlock(block.id, { content: e.target.value })}
                onBlur={() => setEditingBlock(null)}
                autoFocus
                rows={Math.max(1, block.content.split('\n').length)}
              />
            ) : (
              <div style={{ fontSize: 15, lineHeight: 1.6, minHeight: 24, whiteSpace: 'pre-wrap' }}>
                {block.content || <span style={{ opacity: 0.3 }}>Type something…</span>}
              </div>
            )}
          </div>
        )
      case 'checklist':
        return (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <input
              type="checkbox"
              checked={block.checked || false}
              onChange={e => updateBlock(block.id, { checked: e.target.checked })}
              style={{
                width: 18, height: 18, marginTop: 2, cursor: 'pointer',
                accentColor: '#4361EE', borderRadius: 4,
              }}
            />
            <div onClick={() => setEditingBlock(block.id)}
              style={{ flex: 1, cursor: 'text', textDecoration: block.checked ? 'line-through' : 'none', opacity: block.checked ? 0.5 : 1 }}>
              {isEditing ? (
                <input {...commonInput}
                  style={{ ...commonInput.style, fontSize: 15, lineHeight: 1.6 }}
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
                <span style={{ fontSize: 15, lineHeight: 1.6 }}>
                  {block.content || <span style={{ opacity: 0.3 }}>To-do item</span>}
                </span>
              )}
            </div>
          </div>
        )
      case 'code':
        return (
          <div style={{
            background: 'var(--mm-hover-bg, rgba(29,28,29,0.04))', borderRadius: 8,
            padding: 16, fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
            fontSize: 13, lineHeight: 1.5, overflow: 'auto',
            border: '1px solid var(--mm-border)',
          }}>
            {isEditing ? (
              <textarea {...commonInput}
                style={{
                  ...commonInput.style, fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5,
                  minHeight: 60, whiteSpace: 'pre',
                }}
                value={block.content}
                onChange={e => updateBlock(block.id, { content: e.target.value })}
                onBlur={() => setEditingBlock(null)}
                autoFocus
              />
            ) : (
              <pre onClick={() => setEditingBlock(block.id)} style={{ margin: 0, cursor: 'text', whiteSpace: 'pre-wrap' }}>
                {block.content || <span style={{ opacity: 0.3 }}>Code block</span>}
              </pre>
            )}
          </div>
        )
      case 'callout':
        return (
          <div style={{
            background: `${block.color || '#4361EE'}12`, borderLeft: `3px solid ${block.color || '#4361EE'}`,
            borderRadius: 8, padding: '12px 16px', fontSize: 14, lineHeight: 1.6,
          }}>
            {isEditing ? (
              <textarea {...commonInput}
                style={{ ...commonInput.style, fontSize: 14, lineHeight: 1.6, minHeight: 20 }}
                value={block.content}
                onChange={e => updateBlock(block.id, { content: e.target.value })}
                onBlur={() => setEditingBlock(null)}
                autoFocus
                rows={2}
              />
            ) : (
              <div onClick={() => setEditingBlock(block.id)} style={{ cursor: 'text' }}>
                {block.content || <span style={{ opacity: 0.3 }}>Callout</span>}
              </div>
            )}
          </div>
        )
      case 'quote':
        return (
          <div style={{
            borderLeft: '3px solid var(--mm-border)', paddingLeft: 16,
            fontStyle: 'italic', opacity: 0.85, fontSize: 15, lineHeight: 1.6,
          }}>
            {isEditing ? (
              <textarea {...commonInput}
                style={{ ...commonInput.style, fontSize: 15, fontStyle: 'italic', lineHeight: 1.6, minHeight: 20 }}
                value={block.content}
                onChange={e => updateBlock(block.id, { content: e.target.value })}
                onBlur={() => setEditingBlock(null)}
                autoFocus
              />
            ) : (
              <div onClick={() => setEditingBlock(block.id)} style={{ cursor: 'text' }}>
                {block.content || <span style={{ opacity: 0.3 }}>Quote</span>}
              </div>
            )}
          </div>
        )
      case 'divider':
        return <hr style={{ border: 'none', borderTop: '1px solid var(--mm-border)', margin: '8px 0' }} />
      default:
        return null
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--mm-main-bg)', color: 'var(--mm-text)',
      borderLeft: '1px solid var(--mm-border)',
      animation: 'slack-panel-slide-in 250ms var(--slack-ease-out) forwards',
    }}>
      {/* Toolbar */}
      <div style={{
        padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--mm-border)',
        background: 'var(--mm-rhs-bg)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StickyNote size={16} style={{ color: 'var(--mm-link)' }} />
          <span style={{ fontWeight: 700, fontSize: 15 }}>Canvas</span>
          <span style={{ opacity: 0.5, fontSize: 12 }}>#{channelName}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', gap: -4 }}>
            {collaborators.map((c, i) => (
              <div key={i} style={{
                width: 24, height: 24, borderRadius: '50%',
                background: 'linear-gradient(135deg, #4361EE, #4CC9F0)',
                display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700, color: '#fff',
                border: '2px solid var(--mm-main-bg)',
                marginLeft: i > 0 ? -8 : 0, zIndex: collaborators.length - i,
                position: 'relative',
              }}>
                {c.name[0]}
                {c.status === 'online' && (
                  <div style={{
                    position: 'absolute', bottom: -1, right: -1,
                    width: 8, height: 8, borderRadius: '50%',
                    background: '#2bac76', border: '2px solid var(--mm-main-bg)',
                  }} />
                )}
              </div>
            ))}
          </div>
          <span style={{ fontSize: 11, opacity: 0.5 }}>Saved at {lastSaved}</span>
          <button onClick={() => setShowShareMenu(!showShareMenu)} style={{
            background: 'var(--mm-hover-bg)', border: '1px solid var(--mm-border)',
            borderRadius: 8, padding: '4px 12px', fontSize: 12, cursor: 'pointer',
            color: 'var(--mm-text)',
          }}>
            Share
          </button>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--mm-muted)', padding: 4, lineHeight: 1,
          }}><X size={18} /></button>
        </div>
      </div>

      {/* Canvas Body */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '24px 32px',
        maxWidth: 800, margin: '0 auto', width: '100%',
      }}>
        {blocks.map((block, idx) => (
          <div key={block.id} className="canvas-block-wrapper" style={{
            position: 'relative', marginBottom: 6,
            padding: '4px 0', borderRadius: 8,
          }}>
            {/* Block hover controls */}
            <div className="canvas-block-controls" style={{
              position: 'absolute', left: -40, top: '50%', transform: 'translateY(-50%)',
              display: 'flex', flexDirection: 'column', gap: 2,
              opacity: 0, transition: 'opacity 150ms ease',
            }}>
              <button onClick={() => setShowBlockMenu(showBlockMenu === block.id ? null : block.id)}
                title="Add block" style={{
                  width: 24, height: 24, borderRadius: 6, border: 'none',
                  background: 'var(--mm-hover-bg)', cursor: 'pointer',
                  display: 'grid', placeItems: 'center', fontSize: 14, color: 'var(--mm-muted)',
                }}>+</button>
              {block.type !== 'divider' && (
                <button onClick={() => deleteBlock(block.id)} title="Delete" style={{
                  width: 24, height: 24, borderRadius: 6, border: 'none',
                  background: 'var(--mm-hover-bg)', cursor: 'pointer',
                  display: 'grid', placeItems: 'center', fontSize: 12, color: 'var(--mm-muted)',
                }}>×</button>
              )}
            </div>

            {renderBlock(block)}

            {/* Block menu */}
            {showBlockMenu === block.id && (
              <div style={{
                position: 'absolute', left: 0, top: '100%', zIndex: 100,
                background: 'var(--mm-main-bg)', borderRadius: 12,
                boxShadow: 'var(--slack-shadow-modal)',
                padding: 8, width: 200,
                animation: 'slack-slide-up 150ms var(--slack-ease-bounce) forwards',
              }}>
                {BLOCK_TEMPLATES.map(t => (
                  <button key={t.type} onClick={() => addBlockAfter(block.id, t.type)} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', padding: '8px 12px', borderRadius: 8,
                    border: 'none', background: 'none', cursor: 'pointer',
                    fontSize: 13, color: 'var(--mm-text)', textAlign: 'left',
                    transition: 'background 100ms ease',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--mm-hover-bg)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    <span style={{
                      width: 28, height: 28, borderRadius: 6,
                      background: 'var(--mm-hover-bg)', display: 'grid', placeItems: 'center',
                      fontSize: 13, fontWeight: 600,
                    }}>{t.icon}</span>
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Add block CTA */}
        <div style={{
          padding: '16px 0', display: 'flex', justifyContent: 'center',
        }}>
          <button onClick={() => {
            const lastBlock = blocks[blocks.length - 1]
            if (lastBlock) addBlockAfter(lastBlock.id, 'paragraph')
          }} style={{
            background: 'none', border: '1px dashed var(--mm-border)',
            borderRadius: 8, padding: '8px 24px', fontSize: 13,
            color: 'var(--mm-muted)', cursor: 'pointer',
            transition: 'all 150ms ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--mm-link)'; e.currentTarget.style.color = 'var(--mm-link)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--mm-border)'; e.currentTarget.style.color = 'var(--mm-muted)' }}
          >
            + Add a block
          </button>
        </div>
      </div>
    </div>
  )
}
