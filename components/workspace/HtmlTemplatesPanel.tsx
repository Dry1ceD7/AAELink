'use client'

/**
 * HTML/Block-tree templates panel.
 *
 * Lists Puzzle Box templates (schema_version=2 block trees and the older
 * HTML-source templates) and opens the PuzzleBoxEditor for create/edit.
 * The actual editing is in PuzzleBoxEditor — this is the index view.
 */

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api/apiClient'
import {
  Code, Plus, RefreshCw, AlertCircle, Trash2, Loader2,
} from 'lucide-react'
import { useConfirm } from '@/components/a11y'
import { PuzzleBoxEditor } from '@/components/documents/PuzzleBoxEditor'
import { emptyDocument, type DocumentTree, type PageSize } from '@/lib/documents/puzzleBox/blocks'

interface TemplateRow {
  id: string
  workspace_id: string
  kind: string
  name: string
  version: number
  page_size: PageSize
  required_fields: string[]
  is_active: boolean
  schema_version: '1' | '2'
  block_tree: DocumentTree | null
  created_at: number
}

interface SeedSummary {
  kind: string
  name: string
  description: string
  page_size: string
  block_count: number
}

export function HtmlTemplatesPanel({ workspaceId }: { workspaceId: string }) {
  const { confirm, confirmDialog } = useConfirm()
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [seeds, setSeeds] = useState<SeedSummary[]>([])
  const [editorState, setEditorState] = useState<{
    open: boolean
    template?: TemplateRow
  }>({ open: false })

  const load = useCallback(async () => {
    if (!workspaceId) return
    setError('')
    try {
      const res = await apiFetch(`/api/documents/templates?workspace_id=${encodeURIComponent(workspaceId)}&include_inactive=1&with_tree=1`)
      if (!res.ok) {
        setError('Could not load templates.')
        return
      }
      const data = (await res.json()) as { templates?: TemplateRow[] }
      setTemplates(data.templates || [])
    } catch {
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => { void load() }, [load])

  // Seed catalogue (loaded once)
  useEffect(() => {
    void (async () => {
      const res = await apiFetch('/api/documents/templates/seed')
      if (res.ok) {
        const data = (await res.json()) as { seeds?: SeedSummary[] }
        setSeeds(data.seeds || [])
      }
    })()
  }, [])

  const startCreate = () => {
    setEditorState({
      open: true,
      template: undefined,
    })
  }

  const startEdit = (t: TemplateRow) => {
    setEditorState({ open: true, template: t })
  }

  const insertSeed = async (seedKind: string) => {
    setError('')
    const res = await apiFetch('/api/documents/templates/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, seed_kind: seedKind }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Could not insert seed template.')
      return
    }
    await load()
  }

  const deactivate = async (t: TemplateRow) => {
    if (!(await confirm({
      title: 'Deactivate template?',
      message: `Mark "${t.name}" v${t.version} as inactive? It is hidden from the assembly picker but the version is preserved for the audit trail and existing assemblies.`,
      danger: true,
      confirmLabel: 'Deactivate',
    }))) return
    setError('')
    const res = await apiFetch('/api/documents/templates', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: t.id, is_active: false }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Could not deactivate template.')
      return
    }
    await load()
  }

  if (!workspaceId) return <p className="doc-muted">Choose a workspace to manage templates.</p>

  // Fullscreen editor mount
  if (editorState.open) {
    const tree = editorState.template?.block_tree ?? emptyDocument(editorState.template?.page_size || 'A4')
    return (
      <PuzzleBoxEditor
        workspaceId={workspaceId}
        templateId={editorState.template?.id}
        initialKind={editorState.template?.kind || 'invoice'}
        initialName={editorState.template?.name || 'New template'}
        initialPageSize={editorState.template?.page_size || 'A4'}
        initialDocument={tree}
        onClose={() => { setEditorState({ open: false }); void load() }}
        onSaved={() => { setEditorState({ open: false }); void load() }}
      />
    )
  }

  return (
    <>
      <div className="module-panel html-templates-panel">
        <div className="module-panel-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Code size={16} style={{ color: 'var(--aae-accent, var(--aae-link))' }} />
            <h3 style={{ margin: 0, fontSize: 14 }}>Document templates (Puzzle Box)</h3>
          </div>
          <div style={{ flex: 1 }} />
          <button type="button" className="ghost-button" onClick={() => void load()} style={{ fontSize: 12 }}>
            <RefreshCw size={12} style={{ marginRight: 4 }} /> Refresh
          </button>
          <button type="button" className="module-panel-add-btn" onClick={startCreate}>
            <Plus size={13} /> New template
          </button>
        </div>

        <p className="mm-editor-hint" style={{ marginTop: 0 }}>
          Puzzle Box templates are made of typed blocks — logo, recipient, line
          items, totals, terms, signature. Drag to rearrange, swap a client to
          see the logo and address swap automatically. The Stirling-PDF render
          stage produces the final document.
        </p>

        {error && (
          <div className="mm-auth-alert mm-auth-alert--error" role="alert" style={{ marginBottom: 12 }}>
            <AlertCircle size={16} /> <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="module-panel-loading"><Loader2 size={20} className="spin" /> Loading templates…</div>
        ) : templates.length === 0 ? (
          <div className="module-panel-empty">
            <Code size={36} strokeWidth={1.2} />
            <h3>No templates yet</h3>
            <p>Create a Puzzle Box template — drag blocks onto the canvas and bind every region to a data source.</p>
            {seeds.length > 0 && (
              <>
                <p style={{ fontSize: 12, marginTop: 12 }}>Or start from a bundled sample:</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 6 }}>
                  {seeds.map(s => (
                    <button
                      key={s.kind}
                      type="button"
                      className="slack-button"
                      onClick={() => void insertSeed(s.kind)}
                      style={{ fontSize: 12 }}
                      title={s.description}
                    >
                      <Plus size={12} /> {s.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <ul className="module-panel-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {templates.map(t => (
              <li key={t.id} className="module-panel-card" style={{ marginBottom: 6 }}>
                <div className="module-panel-card-header">
                  <div className="module-panel-card-avatar module-panel-card-avatar--template">
                    <Code size={16} />
                  </div>
                  <div className="module-panel-card-info">
                    <div className="module-panel-card-name">
                      {t.name}
                      <span className="module-panel-badge" style={{ marginLeft: 6 }}>{t.kind}</span>
                      <span className="module-panel-badge module-panel-badge--muted" style={{ marginLeft: 4 }}>v{t.version}</span>
                      <span className="module-panel-badge module-panel-badge--muted" style={{ marginLeft: 4 }}>schema {t.schema_version}</span>
                      {!t.is_active && <span className="module-panel-badge module-panel-badge--muted" style={{ marginLeft: 4 }}>Inactive</span>}
                    </div>
                    <div className="module-panel-card-meta">
                      <span>{t.page_size}</span>
                      <span>{(t.required_fields || []).length} required field{(t.required_fields || []).length === 1 ? '' : 's'}</span>
                      {t.block_tree && <span>{Object.keys(t.block_tree.blocks).length} blocks</span>}
                    </div>
                  </div>
                  <div className="module-panel-card-actions">
                    <button type="button" title="Edit / new version" onClick={() => startEdit(t)}>Edit</button>
                    <button type="button" title="Deactivate" onClick={() => void deactivate(t)}><Trash2 size={14} /></button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {confirmDialog}
    </>
  )
}
