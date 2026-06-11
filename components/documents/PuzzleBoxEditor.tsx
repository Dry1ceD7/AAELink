'use client'

/**
 * Puzzle Box editor — block-tree document designer.
 *
 * Three columns:
 *   - left: palette of typed blocks (logo, recipient, line items, …)
 *   - middle: page canvas with absolute-positioned blocks; drag to move,
 *             handles to resize, click to select
 *   - right: inspector for the selected block — every input shown with its
 *           current binding (client.name, formula, manual…) and a swap-menu
 *
 * Above the canvas: a workspace-scope client picker. Picking a different
 * client re-runs preview and every block bound to `client.*` updates
 * atomically. That's the "swap logo for each customer" behaviour.
 */

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  Layers, Plus, Save, Trash2, RotateCcw, AlertCircle, Loader2,
  Image as IconImage, User, Building2, Truck, Tag, Table, Sigma, FileText, Pen,
  StickyNote, Type, Minus, Rows3, X,
} from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import {
  BLOCK_LIBRARY, validateDocument, emptyDocument, slot, isSlot, newBlockId,
  PAGE_DIMENSIONS_MM,
  type Block, type BlockType, type DocumentTree, type Slot, type SlotSource,
  type PageSize,
} from '@/lib/documents/puzzleBox/blocks'
import { findBoundSlots } from '@/lib/documents/puzzleBox/resolve'

interface ClientOption {
  id: string
  name: string
  code: string
  logo_bucket_key?: string
}

interface Props {
  workspaceId: string
  templateId?: string | null
  initialKind?: string
  initialName?: string
  initialPageSize?: PageSize
  initialDocument?: DocumentTree
  onClose?: () => void
  onSaved?: (templateId: string) => void
}

const ICONS: Record<string, React.ReactNode> = {
  'image': <IconImage size={14} />,
  'building-2': <Building2 size={14} />,
  'user': <User size={14} />,
  'truck': <Truck size={14} />,
  'tag': <Tag size={14} />,
  'table': <Table size={14} />,
  'sigma': <Sigma size={14} />,
  'file-text': <FileText size={14} />,
  'pen': <Pen size={14} />,
  'sticky-note': <StickyNote size={14} />,
  'type': <Type size={14} />,
  'minus': <Minus size={14} />,
  'rows': <Rows3 size={14} />,
}

const PIXELS_PER_MM = 3.7795275591 // CSS px-per-mm at 96dpi

function mmToPx(mm: number, scale: number): number {
  return mm * PIXELS_PER_MM * scale
}
function pxToMm(px: number, scale: number): number {
  return px / (PIXELS_PER_MM * scale)
}

/* ─────────────────────────── Component ──────────────────────────────── */

export function PuzzleBoxEditor({
  workspaceId, templateId, initialKind = 'invoice', initialName = 'New template',
  initialPageSize = 'A4', initialDocument, onClose, onSaved,
}: Props) {
  const [doc, setDoc] = useState<DocumentTree>(() => initialDocument || emptyDocument(initialPageSize))
  const [kind, setKind] = useState(initialKind)
  const [name, setName] = useState(initialName)
  const [requiredFields, setRequiredFields] = useState<string[]>([])
  const [requiredInput, setRequiredInput] = useState('')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [scale, setScale] = useState(0.65)
  const [previewClientId, setPreviewClientId] = useState('')
  const [previewHtml, setPreviewHtml] = useState<string>('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [clients, setClients] = useState<ClientOption[]>([])

  const canvasRef = useRef<HTMLDivElement>(null)

  // Load workspace clients once
  useEffect(() => {
    void (async () => {
      const res = await apiFetch(`/api/clients?workspace_id=${encodeURIComponent(workspaceId)}&limit=200`)
      if (res.ok) {
        const data = (await res.json()) as { clients?: ClientOption[] }
        setClients(data.clients || [])
        if (data.clients?.length && !previewClientId) setPreviewClientId(data.clients[0].id)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  /* ─── Block palette actions ─── */

  const addBlock = useCallback((type: BlockType) => {
    const spec = BLOCK_LIBRARY[type]
    const blockId = newBlockId(type)
    const layout = {
      page: 1,
      x_mm: 10,
      y_mm: 10 + Object.keys(doc.blocks).length * 4, // cascading insert
      w_mm: spec.default_size_mm.w,
      h_mm: spec.default_size_mm.h,
    }
    const block = spec.factory(blockId, layout)
    setDoc(prev => {
      const next: DocumentTree = {
        ...prev,
        blocks: { ...prev.blocks, [blockId]: block },
        pages: prev.pages.map((p, i) => i === 0 ? { ...p, block_ids: [...p.block_ids, blockId] } : p),
      }
      return next
    })
    setSelectedId(blockId)
  }, [doc.blocks])

  const removeBlock = useCallback((blockId: string) => {
    setDoc(prev => {
      const { [blockId]: _removed, ...rest } = prev.blocks
      void _removed
      return {
        ...prev,
        blocks: rest,
        pages: prev.pages.map(p => ({ ...p, block_ids: p.block_ids.filter(id => id !== blockId) })),
      }
    })
    if (selectedId === blockId) setSelectedId(null)
  }, [selectedId])

  const updateBlock = useCallback((blockId: string, mutator: (b: Block) => Block) => {
    setDoc(prev => {
      const block = prev.blocks[blockId]
      if (!block) return prev
      return { ...prev, blocks: { ...prev.blocks, [blockId]: mutator(block) } }
    })
  }, [])

  /* ─── Canvas drag + resize ─── */

  const dragStateRef = useRef<{
    blockId: string
    startX: number
    startY: number
    startLayoutX: number
    startLayoutY: number
    mode: 'move' | 'resize-br'
    startW: number
    startH: number
  } | null>(null)

  const onCanvasPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>, blockId: string, mode: 'move' | 'resize-br') => {
    e.preventDefault()
    e.stopPropagation()
    const block = doc.blocks[blockId]
    if (!block) return
    setSelectedId(blockId)
    dragStateRef.current = {
      blockId,
      startX: e.clientX,
      startY: e.clientY,
      startLayoutX: block.layout.x_mm,
      startLayoutY: block.layout.y_mm,
      startW: block.layout.w_mm,
      startH: block.layout.h_mm,
      mode,
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [doc.blocks])

  const onCanvasPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current
    if (!drag) return
    const dxMm = pxToMm(e.clientX - drag.startX, scale)
    const dyMm = pxToMm(e.clientY - drag.startY, scale)
    const dim = PAGE_DIMENSIONS_MM[doc.page_size]
    setDoc(prev => {
      const block = prev.blocks[drag.blockId]
      if (!block) return prev
      const layout = { ...block.layout }
      if (drag.mode === 'move') {
        layout.x_mm = Math.max(0, Math.min(dim.w - layout.w_mm, drag.startLayoutX + dxMm))
        layout.y_mm = Math.max(0, Math.min(dim.h - layout.h_mm, drag.startLayoutY + dyMm))
      } else if (drag.mode === 'resize-br') {
        layout.w_mm = Math.max(10, Math.min(dim.w - layout.x_mm, drag.startW + dxMm))
        layout.h_mm = Math.max(8, Math.min(dim.h - layout.y_mm, drag.startH + dyMm))
      }
      return { ...prev, blocks: { ...prev.blocks, [drag.blockId]: { ...block, layout } } }
    })
  }, [scale, doc.page_size])

  const onCanvasPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current) {
      ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
      dragStateRef.current = null
    }
  }, [])

  /* ─── Keyboard reorder (a11y) ─── */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selectedId) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const step = e.shiftKey ? 5 : 1
      const dim = PAGE_DIMENSIONS_MM[doc.page_size]
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        setDoc(prev => {
          const block = prev.blocks[selectedId]
          if (!block) return prev
          const layout = { ...block.layout }
          if (e.key === 'ArrowUp')    layout.y_mm = Math.max(0, layout.y_mm - step)
          if (e.key === 'ArrowDown')  layout.y_mm = Math.min(dim.h - layout.h_mm, layout.y_mm + step)
          if (e.key === 'ArrowLeft')  layout.x_mm = Math.max(0, layout.x_mm - step)
          if (e.key === 'ArrowRight') layout.x_mm = Math.min(dim.w - layout.w_mm, layout.x_mm + step)
          return { ...prev, blocks: { ...prev.blocks, [selectedId]: { ...block, layout } } }
        })
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault()
          removeBlock(selectedId)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, doc.page_size, removeBlock])

  /* ─── Live preview ─── */

  const refreshPreview = useCallback(async () => {
    setPreviewLoading(true)
    setPreviewError('')
    try {
      const res = await apiFetch('/api/documents/templates/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          block_tree: doc,
          client_profile_id: previewClientId || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setPreviewError(data.error || 'Preview failed.')
        setPreviewHtml('')
        return
      }
      const data = (await res.json()) as { html: string }
      setPreviewHtml(data.html)
    } catch {
      setPreviewError('Network error.')
      setPreviewHtml('')
    } finally {
      setPreviewLoading(false)
    }
  }, [workspaceId, doc, previewClientId])

  // Debounce preview refresh on doc / client change
  useEffect(() => {
    const t = setTimeout(() => { void refreshPreview() }, 350)
    return () => clearTimeout(t)
  }, [refreshPreview])

  /* ─── Save ─── */

  const save = async () => {
    setSaveError('')
    const issues = validateDocument(doc)
    const blocking = issues.filter(i => i.code !== 'orphan_block' && i.code !== 'overflow')
    if (blocking.length) {
      setSaveError(`Template is malformed: ${blocking.map(i => i.message).join('; ')}`)
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        workspace_id: workspaceId,
        kind, name,
        page_size: doc.page_size,
        block_tree: doc,
        style_tokens: doc.style_tokens || {},
        required_fields: requiredFields,
      }
      const url = '/api/documents/templates'
      const method = templateId ? 'PATCH' : 'POST'
      if (templateId) payload.id = templateId

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setSaveError(data.error || 'Save failed.')
        return
      }
      const data = (await res.json()) as { template?: { id: string } }
      onSaved?.(data.template?.id || templateId || '')
    } finally {
      setSaving(false)
    }
  }

  /* ─── Bound-source highlight ─── */

  const clientBoundIds = useMemo(() => {
    const set = new Set<string>()
    for (const k of findBoundSlots(doc, 'client')) {
      set.add(k.split('.')[0])
    }
    return set
  }, [doc])

  const selectedBlock = selectedId ? doc.blocks[selectedId] : null

  const dim = PAGE_DIMENSIONS_MM[doc.page_size]

  return (
    <div className="puzzle-editor" role="region" aria-label="Puzzle Box document editor">
      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <div className="puzzle-editor-toolbar">
        <input
          className="slack-input"
          value={name}
          onChange={e => setName(e.target.value)}
          aria-label="Template name"
          style={{ flex: '0 1 220px' }}
        />
        <input
          className="slack-input"
          value={kind}
          onChange={e => setKind(e.target.value)}
          aria-label="Kind (invoice / quote / report …)"
          style={{ flex: '0 1 140px' }}
        />
        <select
          className="slack-input"
          value={doc.page_size}
          onChange={e => setDoc(prev => ({ ...prev, page_size: e.target.value as PageSize }))}
          aria-label="Page size"
          style={{ flex: '0 1 90px' }}
        >
          {(['A4', 'Letter', 'Legal', 'A3', 'A5'] as PageSize[]).map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span style={{ flex: 1 }} />

        <select
          className="slack-input"
          value={previewClientId}
          onChange={e => setPreviewClientId(e.target.value)}
          aria-label="Preview client"
          style={{ flex: '0 1 220px' }}
          title="Preview as a different client to verify swap behaviour"
        >
          <option value="">— No client —</option>
          {clients.map(c => (
            <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ''}</option>
          ))}
        </select>

        <div className="puzzle-editor-zoom" role="group" aria-label="Zoom">
          <button type="button" className="ghost-button" onClick={() => setScale(s => Math.max(0.3, s - 0.1))}>−</button>
          <span style={{ fontSize: 12, opacity: 0.7, minWidth: 40, textAlign: 'center' }}>{Math.round(scale * 100)}%</span>
          <button type="button" className="ghost-button" onClick={() => setScale(s => Math.min(1.5, s + 0.1))}>+</button>
        </div>

        <button type="button" className="slack-button" onClick={() => void save()} disabled={saving}>
          {saving ? <><Loader2 size={14} className="spin" /> Saving…</> : <><Save size={14} /> Save as new version</>}
        </button>
        {onClose && (
          <button type="button" className="ghost-button" onClick={onClose} aria-label="Close editor"><X size={14} /></button>
        )}
      </div>

      {saveError && (
        <div className="mm-auth-alert mm-auth-alert--error" role="alert" style={{ margin: '8px 16px' }}>
          <AlertCircle size={14} /> <span>{saveError}</span>
        </div>
      )}

      {/* ── Main 3-column layout ────────────────────────────────────── */}
      <div className="puzzle-editor-body">
        {/* Palette */}
        <aside className="puzzle-editor-palette" aria-label="Block palette">
          <h4 className="puzzle-editor-section-title">Add block</h4>
          {(Object.values(BLOCK_LIBRARY)).map(spec => (
            <button
              key={spec.type}
              type="button"
              className="puzzle-palette-item"
              onClick={() => addBlock(spec.type)}
              title={`Insert ${spec.display_name}`}
            >
              {ICONS[spec.icon] || <Layers size={14} />}
              <span>{spec.display_name}</span>
              <Plus size={12} className="puzzle-palette-add" aria-hidden="true" />
            </button>
          ))}

          <h4 className="puzzle-editor-section-title" style={{ marginTop: 16 }}>Required fields</h4>
          <p className="mm-editor-hint" style={{ fontSize: 11, marginTop: 0 }}>
            The assemble stage will fail if any of these come back empty.
          </p>
          <div className="puzzle-required-list">
            {requiredFields.map(f => (
              <span key={f} className="puzzle-required-chip">
                {f}
                <button type="button" aria-label={`Remove ${f}`} onClick={() => setRequiredFields(prev => prev.filter(x => x !== f))}>
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <form
            onSubmit={e => {
              e.preventDefault()
              const v = requiredInput.trim()
              if (v && !requiredFields.includes(v)) setRequiredFields(prev => [...prev, v])
              setRequiredInput('')
            }}
            style={{ display: 'flex', gap: 4, marginTop: 6 }}
          >
            <input
              className="slack-input"
              value={requiredInput}
              onChange={e => setRequiredInput(e.target.value)}
              placeholder="invoice_number"
              style={{ flex: 1, fontSize: 11, padding: 4 }}
            />
            <button type="submit" className="ghost-button" style={{ padding: '4px 8px' }}>Add</button>
          </form>
        </aside>

        {/* Canvas */}
        <div className="puzzle-editor-canvas-wrap">
          <div
            ref={canvasRef}
            className="puzzle-editor-canvas"
            style={{
              width: mmToPx(dim.w, scale),
              height: mmToPx(dim.h, scale),
            }}
            onClick={() => setSelectedId(null)}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            role="application"
            aria-label="Document canvas"
          >
            {doc.pages[0]?.block_ids.map(blockId => {
              const block = doc.blocks[blockId]
              if (!block) return null
              const isSelected = blockId === selectedId
              const isClientBound = clientBoundIds.has(blockId)
              const style: CSSProperties = {
                position: 'absolute',
                left: mmToPx(block.layout.x_mm, scale),
                top: mmToPx(block.layout.y_mm, scale),
                width: mmToPx(block.layout.w_mm, scale),
                height: mmToPx(block.layout.h_mm, scale),
              }
              return (
                <div
                  key={blockId}
                  className={`puzzle-block${isSelected ? ' puzzle-block--selected' : ''}${isClientBound ? ' puzzle-block--client-bound' : ''}${block.locked ? ' puzzle-block--locked' : ''}`}
                  style={style}
                  onPointerDown={e => onCanvasPointerDown(e, blockId, 'move')}
                  onClick={e => { e.stopPropagation(); setSelectedId(blockId) }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${BLOCK_LIBRARY[block.type].display_name} block — click to select, drag to move`}
                >
                  <div className="puzzle-block-label">
                    {ICONS[BLOCK_LIBRARY[block.type].icon] || <Layers size={11} />}
                    <span>{BLOCK_LIBRARY[block.type].display_name}</span>
                  </div>
                  <div
                    className="puzzle-block-handle"
                    onPointerDown={e => onCanvasPointerDown(e, blockId, 'resize-br')}
                    aria-label="Resize"
                  />
                </div>
              )
            })}
          </div>

          {/* Live preview pane */}
          <div className="puzzle-editor-preview" aria-label="Live preview">
            <div className="puzzle-editor-preview-head">
              <span style={{ fontSize: 12, fontWeight: 600 }}>Live preview</span>
              <button type="button" className="ghost-button" onClick={() => void refreshPreview()} disabled={previewLoading} style={{ fontSize: 11 }}>
                <RotateCcw size={12} /> {previewLoading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            {previewError ? (
              <div className="mm-auth-alert mm-auth-alert--error" role="alert" style={{ margin: 8 }}>
                <AlertCircle size={14} /> <span>{previewError}</span>
              </div>
            ) : (
              <iframe
                title="Live preview"
                sandbox=""
                srcDoc={previewHtml}
                style={{ width: '100%', flex: 1, minHeight: 320, border: 'none', background: '#fff' }}
              />
            )}
          </div>
        </div>

        {/* Inspector */}
        <aside className="puzzle-editor-inspector" aria-label="Selected block inspector">
          {selectedBlock ? (
            <BlockInspector
              block={selectedBlock}
              onChange={mutator => updateBlock(selectedBlock.id, mutator)}
              onRemove={() => removeBlock(selectedBlock.id)}
            />
          ) : (
            <div className="puzzle-inspector-empty">
              <p style={{ fontSize: 12, color: 'var(--mm-muted)' }}>
                Select a block on the canvas to edit its bindings, or drop a new block from the palette on the left.
              </p>
              <p style={{ fontSize: 11, color: 'var(--mm-muted)', marginTop: 8 }}>
                Tip: blocks bound to <strong>client.*</strong> are highlighted in blue and swap automatically when you change the preview client at the top.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

/* ─────────────────────────── Block inspector ────────────────────────── */

function BlockInspector({
  block, onChange, onRemove,
}: {
  block: Block
  onChange: (mutator: (b: Block) => Block) => void
  onRemove: () => void
}) {
  const spec = BLOCK_LIBRARY[block.type]
  const inputs = (block as unknown as { inputs: Record<string, unknown> }).inputs || {}

  return (
    <div className="puzzle-inspector">
      <div className="puzzle-inspector-head">
        <strong>{spec.display_name}</strong>
        <span className="puzzle-inspector-id">{block.id.slice(-6)}</span>
        <button type="button" className="ghost-button" onClick={onRemove} aria-label="Delete block" title="Delete (Cmd/Ctrl+Backspace)">
          <Trash2 size={13} />
        </button>
      </div>

      {/* Layout */}
      <details open style={{ marginTop: 6 }}>
        <summary style={{ fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Position &amp; size</summary>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
          {(['x_mm', 'y_mm', 'w_mm', 'h_mm'] as const).map(k => (
            <label key={k} style={{ fontSize: 11, color: 'var(--mm-muted)' }}>
              {k.replace('_mm', '')} (mm)
              <input
                type="number"
                className="slack-input"
                step={1}
                value={Math.round(block.layout[k])}
                onChange={e => {
                  const next = Number(e.target.value)
                  onChange(b => ({ ...b, layout: { ...b.layout, [k]: next } }))
                }}
                style={{ fontSize: 12, padding: 4, marginTop: 2 }}
              />
            </label>
          ))}
        </div>
        <label style={{ fontSize: 11, color: 'var(--mm-muted)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <input
            type="checkbox"
            checked={!!block.locked}
            onChange={e => onChange(b => ({ ...b, locked: e.target.checked }))}
          />
          Lock from per-document removal
        </label>
      </details>

      {/* Inputs */}
      <details open style={{ marginTop: 8 }}>
        <summary style={{ fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Bindings</summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
          {Object.entries(inputs).map(([key, value]) => (
            <InspectorRow
              key={key}
              inputKey={key}
              value={value}
              onSlot={(slotKey, nextSlot) => {
                onChange(b => {
                  const draft = JSON.parse(JSON.stringify(b)) as Block & { inputs: Record<string, unknown> }
                  setSlotAt(draft.inputs, slotKey, nextSlot)
                  return draft as Block
                })
              }}
            />
          ))}
        </div>
      </details>
    </div>
  )
}

function setSlotAt(target: Record<string, unknown>, path: string, slotValue: Slot): void {
  // path is the input key — for nested arrays / objects we'd extend, but
  // every block currently exposes top-level slot inputs.
  target[path] = slotValue
}

function InspectorRow({
  inputKey, value, onSlot,
}: {
  inputKey: string
  value: unknown
  onSlot: (key: string, slotValue: Slot) => void
}) {
  if (isSlot(value)) {
    return <SlotEditor label={inputKey} slotValue={value} onChange={s => onSlot(inputKey, s)} />
  }
  if (Array.isArray(value)) {
    return (
      <div style={{ fontSize: 11, color: 'var(--mm-muted)' }}>
        <strong style={{ display: 'block', marginBottom: 2 }}>{inputKey}</strong>
        <span>{value.length} structured entries (edit via the columns / rows table)</span>
      </div>
    )
  }
  return (
    <div style={{ fontSize: 11, color: 'var(--mm-muted)' }}>
      <strong style={{ display: 'block', marginBottom: 2 }}>{inputKey}</strong>
      <span>{value === undefined ? 'unset' : JSON.stringify(value)}</span>
    </div>
  )
}

function SlotEditor({
  label, slotValue, onChange,
}: {
  label: string
  slotValue: Slot
  onChange: (next: Slot) => void
}) {
  const [draft, setDraft] = useState<Slot>(slotValue)
  // Sync when the parent changes the slot externally (e.g. switching blocks)
  useLayoutEffect(() => { setDraft(slotValue) }, [slotValue])

  const commit = (next: Slot) => {
    setDraft(next)
    onChange(next)
  }

  return (
    <div style={{ borderLeft: '2px solid var(--mm-border-subtle)', paddingLeft: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <strong style={{ fontSize: 11 }}>{label}</strong>
        <select
          value={draft.source}
          onChange={e => commit({ ...draft, source: e.target.value as SlotSource })}
          className="slack-input"
          style={{ fontSize: 11, padding: 2, width: 110 }}
          aria-label={`Source for ${label}`}
        >
          <option value="manual">manual</option>
          <option value="client">client</option>
          <option value="workspace">workspace</option>
          <option value="assembly">assembly</option>
          <option value="ticket">ticket</option>
          <option value="user">user</option>
          <option value="formula">formula</option>
        </select>
      </div>

      {draft.source === 'manual' ? (
        <input
          className="slack-input"
          value={draft.fallback}
          onChange={e => commit({ ...draft, fallback: e.target.value })}
          placeholder="Literal text"
          style={{ fontSize: 12, padding: 4 }}
        />
      ) : draft.source === 'formula' ? (
        <input
          className="slack-input"
          value={draft.path}
          onChange={e => commit({ ...draft, path: e.target.value })}
          placeholder="sum:assembly.line_items[].amount"
          style={{ fontSize: 12, padding: 4, fontFamily: 'monospace' }}
        />
      ) : (
        <>
          <input
            className="slack-input"
            value={draft.path}
            onChange={e => commit({ ...draft, path: e.target.value })}
            placeholder={`${draft.source}.field_name`}
            style={{ fontSize: 12, padding: 4, fontFamily: 'monospace' }}
          />
          <input
            className="slack-input"
            value={draft.fallback}
            onChange={e => commit({ ...draft, fallback: e.target.value })}
            placeholder="Fallback if empty"
            style={{ fontSize: 11, padding: 4, marginTop: 4, opacity: 0.85 }}
          />
        </>
      )}

      <div style={{ fontSize: 10, color: 'var(--mm-muted)', marginTop: 2 }}>
        {draft.source === 'manual' && 'Literal text — never swaps.'}
        {draft.source === 'client' && 'Swaps when the bound client changes.'}
        {draft.source === 'workspace' && 'Pulls from your workspace brand settings.'}
        {draft.source === 'assembly' && 'Pulls from the in-flight document data (PuzzlePiece).'}
        {draft.source === 'ticket' && 'Pulls from the originating ticket.'}
        {draft.source === 'user' && 'Pulls from the signed-in user (signature, name, …).'}
        {draft.source === 'formula' && 'Computed at render: sum/avg/min/max/count.'}
      </div>
    </div>
  )
}
