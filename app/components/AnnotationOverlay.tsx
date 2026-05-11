'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  Highlighter, StickyNote, Pen, MessageSquare, Trash2, Check,
  ChevronDown, Circle
} from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'

// ── Types ───────────────────────────────────────────────────────────────────

export type AnnotationType = 'highlight' | 'sticky_note' | 'freehand' | 'stamp' | 'comment' | 'text_markup' | 'redaction_mark'

export interface Annotation {
  id: string
  document_id: string
  page_number: number
  type: AnnotationType
  content: string
  coordinates: {
    x?: number; y?: number; width?: number; height?: number
    points?: { x: number; y: number }[]
  }
  style: {
    color?: string; opacity?: number; fontSize?: number
    strokeWidth?: number; fillColor?: string
  }
  author_id: string
  author_username?: string
  author_avatar?: string
  parent_id: string
  resolved: boolean
  created_at: number
  updated_at: number
}

const ANNOTATION_COLORS = [
  '#FDE047', // Yellow
  '#86EFAC', // Green
  '#93C5FD', // Blue
  '#FCA5A5', // Red
  '#C4B5FD', // Purple
  '#FDBA74', // Orange
]

const TOOL_CONFIG: { type: AnnotationType; icon: typeof Highlighter; label: string }[] = [
  { type: 'highlight', icon: Highlighter, label: 'Highlight' },
  { type: 'sticky_note', icon: StickyNote, label: 'Sticky Note' },
  { type: 'freehand', icon: Pen, label: 'Freehand' },
  { type: 'comment', icon: MessageSquare, label: 'Comment' },
]

// ── Annotation Item ─────────────────────────────────────────────────────────

const AnnotationItem = memo(function AnnotationItem({
  annotation: ann,
  isSelected,
  onSelect,
  onResolve,
  onDelete,
}: {
  annotation: Annotation
  isSelected: boolean
  onSelect: (id: string) => void
  onResolve: (id: string) => void
  onDelete: (id: string) => void
}) {
  return (
    <div
      className={`anno-list-item${isSelected ? ' anno-list-item--selected' : ''}${ann.resolved ? ' anno-list-item--resolved' : ''}`}
      onClick={() => onSelect(ann.id)}
    >
      <div className="anno-list-item-header">
        <span
          className="anno-list-item-dot"
          style={{ background: ann.style.color || ANNOTATION_COLORS[0] }}
        />
        <span className="anno-list-item-type">{ann.type.replace('_', ' ')}</span>
        {ann.author_username && (
          <span className="anno-list-item-author">@{ann.author_username}</span>
        )}
        {ann.resolved && <span className="anno-badge anno-badge--resolved">Resolved</span>}
      </div>

      {ann.content && (
        <p className="anno-list-item-content">{ann.content}</p>
      )}

      <div className="anno-list-item-actions">
        <span className="anno-list-item-date">
          {new Date(ann.created_at).toLocaleString()}
        </span>
        <div className="anno-list-item-btns">
          {!ann.resolved && (
            <button type="button" className="mm-icon-btn" title="Resolve"
              onClick={e => { e.stopPropagation(); onResolve(ann.id) }}>
              <Check size={13} />
            </button>
          )}
          <button type="button" className="mm-icon-btn" title="Delete"
            onClick={e => { e.stopPropagation(); onDelete(ann.id) }}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  )
})

// ── Canvas Drawing Layer ────────────────────────────────────────────────────

function DrawingCanvas({
  width,
  height,
  activeTool,
  activeColor,
  annotations,
  selectedId,
  onCreateAnnotation,
  onSelectAnnotation,
}: {
  width: number
  height: number
  activeTool: AnnotationType | null
  activeColor: string
  annotations: Annotation[]
  selectedId: string | null
  onCreateAnnotation: (ann: Partial<Annotation>) => void
  onSelectAnnotation: (id: string | null) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null)
  const [freehandPoints, setFreehandPoints] = useState<{ x: number; y: number }[]>([])
  const [noteInput, setNoteInput] = useState<{ x: number; y: number; show: boolean }>({ x: 0, y: 0, show: false })
  const [noteText, setNoteText] = useState('')

  // Render annotations on canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, width, height)

    for (const ann of annotations) {
      const { coordinates: c, style: s } = ann
      const color = s.color || ANNOTATION_COLORS[0]
      const opacity = s.opacity ?? 0.3
      const isCurrentSelected = ann.id === selectedId

      ctx.save()

      if (ann.type === 'highlight' && c.x != null && c.y != null && c.width && c.height) {
        ctx.globalAlpha = ann.resolved ? opacity * 0.3 : opacity
        ctx.fillStyle = color
        ctx.fillRect(c.x, c.y, c.width, c.height)
        if (isCurrentSelected) {
          ctx.globalAlpha = 1
          ctx.strokeStyle = color
          ctx.lineWidth = 2
          ctx.setLineDash([4, 4])
          ctx.strokeRect(c.x - 1, c.y - 1, c.width + 2, c.height + 2)
        }
      }

      if (ann.type === 'freehand' && c.points && c.points.length > 1) {
        ctx.globalAlpha = ann.resolved ? 0.2 : 0.8
        ctx.strokeStyle = color
        ctx.lineWidth = s.strokeWidth || 2
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        ctx.moveTo(c.points[0].x, c.points[0].y)
        for (let i = 1; i < c.points.length; i++) {
          ctx.lineTo(c.points[i].x, c.points[i].y)
        }
        ctx.stroke()
      }

      if ((ann.type === 'sticky_note' || ann.type === 'comment') && c.x != null && c.y != null) {
        const w = 24
        ctx.globalAlpha = ann.resolved ? 0.3 : 0.9
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.roundRect(c.x - w / 2, c.y - w / 2, w, w, 4)
        ctx.fill()
        // Icon indicator
        ctx.globalAlpha = 1
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 12px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(ann.type === 'sticky_note' ? 'N' : 'C', c.x, c.y)

        if (isCurrentSelected) {
          ctx.strokeStyle = '#4f46e5'
          ctx.lineWidth = 2
          ctx.setLineDash([3, 3])
          ctx.strokeRect(c.x - w / 2 - 2, c.y - w / 2 - 2, w + 4, w + 4)
        }
      }

      ctx.restore()
    }

    // Draw active freehand path
    if (isDrawing && activeTool === 'freehand' && freehandPoints.length > 1) {
      ctx.save()
      ctx.strokeStyle = activeColor
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.globalAlpha = 0.8
      ctx.beginPath()
      ctx.moveTo(freehandPoints[0].x, freehandPoints[0].y)
      for (let i = 1; i < freehandPoints.length; i++) {
        ctx.lineTo(freehandPoints[i].x, freehandPoints[i].y)
      }
      ctx.stroke()
      ctx.restore()
    }

    // Draw active highlight rect
    if (isDrawing && activeTool === 'highlight' && startPos) {
      const end = freehandPoints[freehandPoints.length - 1]
      if (end) {
        ctx.save()
        ctx.globalAlpha = 0.25
        ctx.fillStyle = activeColor
        ctx.fillRect(
          Math.min(startPos.x, end.x), Math.min(startPos.y, end.y),
          Math.abs(end.x - startPos.x), Math.abs(end.y - startPos.y)
        )
        ctx.restore()
      }
    }
  }, [annotations, selectedId, isDrawing, freehandPoints, activeTool, activeColor, startPos, width, height])

  const getPos = (e: React.MouseEvent): { x: number; y: number } => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!activeTool) {
      // Click-select mode: find annotation under cursor
      const pos = getPos(e)
      const hit = [...annotations].reverse().find(a => {
        const c = a.coordinates
        if (a.type === 'highlight' && c.x != null && c.y != null && c.width && c.height) {
          return pos.x >= c.x && pos.x <= c.x + c.width && pos.y >= c.y && pos.y <= c.y + c.height
        }
        if ((a.type === 'sticky_note' || a.type === 'comment') && c.x != null && c.y != null) {
          return Math.abs(pos.x - c.x) < 16 && Math.abs(pos.y - c.y) < 16
        }
        return false
      })
      onSelectAnnotation(hit?.id ?? null)
      return
    }

    const pos = getPos(e)

    if (activeTool === 'sticky_note' || activeTool === 'comment') {
      setNoteInput({ x: pos.x, y: pos.y, show: true })
      setNoteText('')
      return
    }

    setIsDrawing(true)
    setStartPos(pos)
    setFreehandPoints([pos])
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing) return
    const pos = getPos(e)
    setFreehandPoints(prev => [...prev, pos])
  }

  const handleMouseUp = () => {
    if (!isDrawing || !startPos) { setIsDrawing(false); return }

    if (activeTool === 'highlight') {
      const endPos = freehandPoints[freehandPoints.length - 1]
      if (endPos) {
        const x = Math.min(startPos.x, endPos.x)
        const y = Math.min(startPos.y, endPos.y)
        const w = Math.abs(endPos.x - startPos.x)
        const h = Math.abs(endPos.y - startPos.y)
        if (w > 5 && h > 3) {
          onCreateAnnotation({
            type: 'highlight',
            coordinates: { x, y, width: w, height: h },
            style: { color: activeColor, opacity: 0.3 },
          })
        }
      }
    }

    if (activeTool === 'freehand' && freehandPoints.length > 3) {
      onCreateAnnotation({
        type: 'freehand',
        coordinates: { points: freehandPoints },
        style: { color: activeColor, strokeWidth: 2 },
      })
    }

    setIsDrawing(false)
    setStartPos(null)
    setFreehandPoints([])
  }

  const submitNote = () => {
    if (noteText.trim() && noteInput.show) {
      const type = activeTool === 'comment' ? 'comment' : 'sticky_note'
      onCreateAnnotation({
        type,
        content: noteText.trim(),
        coordinates: { x: noteInput.x, y: noteInput.y },
        style: { color: activeColor },
      })
    }
    setNoteInput({ x: 0, y: 0, show: false })
    setNoteText('')
  }

  return (
    <div className="anno-canvas-wrap" style={{ width, height }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="anno-canvas"
        style={{ cursor: activeTool ? (activeTool === 'freehand' ? 'crosshair' : 'cell') : 'default' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { if (isDrawing) handleMouseUp() }}
      />

      {/* Note input popover */}
      {noteInput.show && (
        <div
          className="anno-note-popover"
          style={{ left: noteInput.x, top: noteInput.y }}
          onClick={e => e.stopPropagation()}
        >
          <textarea
            className="anno-note-textarea"
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            placeholder={activeTool === 'comment' ? 'Add a comment…' : 'Sticky note…'}
            rows={3}
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitNote() }
              if (e.key === 'Escape') setNoteInput({ x: 0, y: 0, show: false })
            }}
          />
          <div className="anno-note-popover-actions">
            <button type="button" className="slack-button" onClick={submitNote}>Add</button>
            <button type="button" className="ghost-button"
              onClick={() => setNoteInput({ x: 0, y: 0, show: false })}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Overlay Component ──────────────────────────────────────────────────

interface AnnotationOverlayProps {
  documentId: string
  pageNumber?: number
  /** Dimensions of the content area to overlay on */
  contentWidth: number
  contentHeight: number
  /** Whether annotations mode is active */
  active: boolean
}

export function AnnotationOverlay({
  documentId,
  pageNumber = 1,
  contentWidth,
  contentHeight,
  active,
}: AnnotationOverlayProps) {
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [activeTool, setActiveTool] = useState<AnnotationType | null>(null)
  const [activeColor, setActiveColor] = useState(ANNOTATION_COLORS[0])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showList, setShowList] = useState(true)

  // Load annotations
  useEffect(() => {
    if (!active || !documentId) return
    setLoading(true)
    void (async () => {
      try {
        const res = await apiFetch(
          `/api/documents/${encodeURIComponent(documentId)}/annotations?page=${pageNumber}`
        )
        if (res.ok) {
          const data = await res.json() as { annotations?: Annotation[] }
          setAnnotations(data.annotations ?? [])
        }
      } catch { /* ignore */ }
      setLoading(false)
    })()
  }, [active, documentId, pageNumber])

  const createAnnotation = useCallback(async (partial: Partial<Annotation>) => {
    const res = await apiFetch(
      `/api/documents/${encodeURIComponent(documentId)}/annotations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: partial.type,
          page_number: pageNumber,
          content: partial.content || '',
          coordinates: partial.coordinates || {},
          style: partial.style || {},
        }),
      }
    )
    if (res.ok) {
      const data = await res.json() as { annotation?: Annotation }
      if (data.annotation) {
        setAnnotations(prev => [...prev, data.annotation!])
      }
    }
  }, [documentId, pageNumber])

  const resolveAnnotation = useCallback(async (id: string) => {
    const res = await apiFetch(
      `/api/documents/${encodeURIComponent(documentId)}/annotations`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotation_id: id, resolved: true }),
      }
    )
    if (res.ok) {
      setAnnotations(prev => prev.map(a => a.id === id ? { ...a, resolved: true } : a))
    }
  }, [documentId])

  const deleteAnnotation = useCallback(async (id: string) => {
    const res = await apiFetch(
      `/api/documents/${encodeURIComponent(documentId)}/annotations`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotation_id: id }),
      }
    )
    if (res.ok) {
      setAnnotations(prev => prev.filter(a => a.id !== id))
      if (selectedId === id) setSelectedId(null)
    }
  }, [documentId, selectedId])

  if (!active) return null

  const unresolvedCount = annotations.filter(a => !a.resolved).length

  return (
    <>
      {/* ── Drawing Canvas (overlays content) ── */}
      <DrawingCanvas
        width={contentWidth}
        height={contentHeight}
        activeTool={activeTool}
        activeColor={activeColor}
        annotations={annotations}
        selectedId={selectedId}
        onCreateAnnotation={createAnnotation}
        onSelectAnnotation={setSelectedId}
      />

      {/* ── Annotation Toolbar (floating) ── */}
      <div className="anno-toolbar">
        {TOOL_CONFIG.map(t => (
          <button
            key={t.type}
            type="button"
            className={`anno-tool-btn${activeTool === t.type ? ' anno-tool-btn--active' : ''}`}
            title={t.label}
            onClick={() => setActiveTool(prev => prev === t.type ? null : t.type)}
          >
            <t.icon size={15} />
          </button>
        ))}

        <div className="anno-toolbar-divider" />

        {/* Color selector */}
        <div className="anno-color-selector">
          {ANNOTATION_COLORS.map(c => (
            <button
              key={c}
              type="button"
              className={`anno-color-swatch${activeColor === c ? ' anno-color-swatch--active' : ''}`}
              style={{ background: c }}
              onClick={() => setActiveColor(c)}
              title={c}
            />
          ))}
        </div>

        <div className="anno-toolbar-divider" />

        <button
          type="button"
          className={`anno-tool-btn${showList ? ' anno-tool-btn--active' : ''}`}
          title={`Annotations (${unresolvedCount})`}
          onClick={() => setShowList(o => !o)}
        >
          <MessageSquare size={15} />
          {unresolvedCount > 0 && (
            <span className="anno-tool-badge">{unresolvedCount}</span>
          )}
        </button>
      </div>

      {/* ── Annotation List Panel ── */}
      {showList && (
        <div className="anno-list-panel">
          <div className="anno-list-header">
            <h4>Annotations</h4>
            <span className="anno-list-count">{annotations.length}</span>
          </div>
          <div className="anno-list-body">
            {loading ? (
              <p className="anno-list-empty">Loading…</p>
            ) : annotations.length === 0 ? (
              <p className="anno-list-empty">
                No annotations yet. Select a tool and click on the document to add one.
              </p>
            ) : (
              annotations.map(a => (
                <AnnotationItem
                  key={a.id}
                  annotation={a}
                  isSelected={selectedId === a.id}
                  onSelect={setSelectedId}
                  onResolve={resolveAnnotation}
                  onDelete={deleteAnnotation}
                />
              ))
            )}
          </div>
        </div>
      )}
    </>
  )
}
