'use client'

/**
 * Puzzle Box assembly pipeline panel.
 *
 * Lists every assembly in the workspace, with per-stage chips, a per-row
 * log drawer, and "Resume" / "Re-run" / "Download" actions. Calls the
 * `/api/documents/assemblies/*` endpoints. New assemblies are created via
 * the `AssemblyIngestModal` mounted at the panel root.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api/apiClient'
import {
  RefreshCw, AlertCircle, ChevronRight, Download, Loader2, Play, Sparkles,
  CheckCircle2, XCircle, Hourglass, Plus,
} from 'lucide-react'
import { useConfirm } from '@/components/a11y'
import { AssemblyIngestModal } from './AssemblyIngestModal'

/* ─────────────────────────── Types ──────────────────────────────────── */

export type PipelineStage =
  | 'ingested'
  | 'extracted'
  | 'normalized'
  | 'assembled'
  | 'rendered'
  | 'delivered'
  | 'failed'

export type StageStatus = 'started' | 'ok' | 'failed' | 'skipped'

export interface AssemblyRow {
  id: string
  workspace_id: string
  template_id: string | null
  client_profile_id: string | null
  stage: PipelineStage
  output_bucket_key: string
  delivery_channel_id: string | null
  delivery_message_id: string
  error: string
  created_by: string | null
  created_at: number
  updated_at: number
  ticket_id?: string | null
}

export interface PipelineLogEntry {
  id: string
  stage: PipelineStage
  status: StageStatus
  duration_ms: number
  detail: Record<string, unknown>
  created_at: number
}

/* ─────────────────────────── Constants ──────────────────────────────── */

const STAGE_ORDER: PipelineStage[] = [
  'ingested', 'extracted', 'normalized', 'assembled', 'rendered', 'delivered',
]

const STAGE_LABEL: Record<PipelineStage, string> = {
  ingested: 'Ingest',
  extracted: 'Extract',
  normalized: 'Normalize',
  assembled: 'Assemble',
  rendered: 'Render',
  delivered: 'Deliver',
  failed: 'Failed',
}

function stageIndex(stage: PipelineStage): number {
  if (stage === 'failed') return -1
  return STAGE_ORDER.indexOf(stage)
}

/* ─────────────────────────── Component ──────────────────────────────── */

export function AssemblyPipelinePanel({ workspaceId }: { workspaceId: string }) {
  const { confirm, confirmDialog } = useConfirm()
  const [assemblies, setAssemblies] = useState<AssemblyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [stageFilter, setStageFilter] = useState<'all' | PipelineStage>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [logs, setLogs] = useState<Record<string, PipelineLogEntry[]>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [ingestOpen, setIngestOpen] = useState(false)

  const load = useCallback(async () => {
    if (!workspaceId) return
    setError('')
    try {
      const params = new URLSearchParams({ workspace_id: workspaceId, limit: '100' })
      if (stageFilter !== 'all') params.set('stage', stageFilter)
      const res = await apiFetch(`/api/documents/assemblies?${params.toString()}`)
      if (!res.ok) {
        setError('Could not load assemblies.')
        return
      }
      const data = (await res.json()) as { assemblies?: AssemblyRow[] }
      setAssemblies(data.assemblies || [])
    } catch {
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, stageFilter])

  useEffect(() => { void load() }, [load])

  const loadLog = useCallback(async (assemblyId: string) => {
    if (logs[assemblyId]) return
    try {
      const res = await apiFetch(`/api/documents/assemblies/${encodeURIComponent(assemblyId)}`)
      if (!res.ok) return
      const data = (await res.json()) as { log?: PipelineLogEntry[] }
      setLogs(prev => ({ ...prev, [assemblyId]: data.log || [] }))
    } catch { /* ignore */ }
  }, [logs])

  const toggleExpand = (id: string) => {
    setExpandedId(prev => (prev === id ? null : id))
    void loadLog(id)
  }

  const runOrResume = useCallback(async (id: string) => {
    setBusyId(id); setError('')
    try {
      const res = await apiFetch(`/api/documents/assemblies/${encodeURIComponent(id)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Run failed.')
        return
      }
      // Refresh both list and log
      setLogs(prev => { const next = { ...prev }; delete next[id]; return next })
      await load()
    } finally {
      setBusyId(null)
    }
  }, [load])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: assemblies.length }
    for (const s of STAGE_ORDER) c[s] = 0
    c.failed = 0
    for (const a of assemblies) c[a.stage] = (c[a.stage] || 0) + 1
    return c
  }, [assemblies])

  if (!workspaceId) return <p className="doc-muted">Choose a workspace to view assemblies.</p>

  return (
    <>
      <div className="module-panel pipeline-panel-module">
        {/* Header */}
        <div className="module-panel-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={16} style={{ color: 'var(--aae-accent, var(--aae-link))' }} />
            <h3 style={{ margin: 0, fontSize: 14 }}>Assembly Pipeline</h3>
          </div>
          <div style={{ flex: 1 }} />
          <button type="button" className="ghost-button" onClick={() => void load()} style={{ fontSize: 12 }}>
            <RefreshCw size={12} style={{ marginRight: 4 }} /> Refresh
          </button>
          <button type="button" className="module-panel-add-btn" onClick={() => setIngestOpen(true)}>
            <Plus size={13} /> New assembly
          </button>
        </div>

        {/* Filter chips */}
        <div className="pipeline-filter-row" role="tablist" aria-label="Filter by stage">
          {(['all', ...STAGE_ORDER, 'failed'] as Array<'all' | PipelineStage>).map(s => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={stageFilter === s}
              className={`pipeline-filter-pill ${stageFilter === s ? 'pipeline-filter-pill--active' : ''} ${s === 'failed' ? 'pipeline-filter-pill--failed' : ''}`}
              onClick={() => setStageFilter(s)}
            >
              {s === 'all' ? 'All' : (s === 'failed' ? 'Failed' : STAGE_LABEL[s as PipelineStage])}
              <span className="pipeline-filter-count">{counts[s] || 0}</span>
            </button>
          ))}
        </div>

        {error && (
          <div className="mm-auth-alert mm-auth-alert--error" role="alert" style={{ margin: '12px 0' }}>
            <AlertCircle size={16} /> <span>{error}</span>
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="module-panel-loading"><Loader2 size={20} className="spin" /> Loading assemblies…</div>
        ) : assemblies.length === 0 ? (
          <div className="module-panel-empty">
            <Sparkles size={36} strokeWidth={1.2} />
            <h3>No assemblies yet</h3>
            <p>Create one from a template, raw text, or a ticket. Click <strong>New assembly</strong> to start.</p>
          </div>
        ) : (
          <ul className="pipeline-row-list" aria-label="Assemblies">
            {assemblies.map(a => (
              <PipelineRow
                key={a.id}
                assembly={a}
                expanded={expandedId === a.id}
                log={logs[a.id]}
                busy={busyId === a.id}
                onToggle={() => toggleExpand(a.id)}
                onRun={() => void runOrResume(a.id)}
                onDownload={a.output_bucket_key ? () => {
                  window.open(`/api/documents/assemblies/${encodeURIComponent(a.id)}/download`, '_blank')
                } : null}
                onDelete={async () => {
                  if (!(await confirm({
                    title: 'Discard assembly?',
                    message: 'The pipeline log and rendered PDF will be removed. Tickets that referenced this assembly keep their record.',
                    danger: true,
                    confirmLabel: 'Discard',
                  }))) return
                  setBusyId(a.id)
                  try {
                    const res = await apiFetch(`/api/documents/assemblies/${encodeURIComponent(a.id)}`, { method: 'DELETE' })
                    if (res.ok) await load()
                  } finally {
                    setBusyId(null)
                  }
                }}
              />
            ))}
          </ul>
        )}
      </div>

      {/* New-assembly modal */}
      {ingestOpen && (
        <AssemblyIngestModal
          workspaceId={workspaceId}
          onClose={() => setIngestOpen(false)}
          onCreated={() => { setIngestOpen(false); void load() }}
        />
      )}

      {confirmDialog}
    </>
  )
}

/* ─────────────────────────── Row ────────────────────────────────────── */

function PipelineRow({
  assembly, expanded, log, busy, onToggle, onRun, onDownload, onDelete,
}: {
  assembly: AssemblyRow
  expanded: boolean
  log: PipelineLogEntry[] | undefined
  busy: boolean
  onToggle: () => void
  onRun: () => void
  onDownload: (() => void) | null
  onDelete: () => void
}) {
  const failed = assembly.stage === 'failed'
  const delivered = assembly.stage === 'delivered'
  const currentIdx = stageIndex(assembly.stage)

  return (
    <li className={`pipeline-row${failed ? ' pipeline-row--failed' : ''}${delivered ? ' pipeline-row--done' : ''}`}>
      <button
        type="button"
        className="pipeline-row-head"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <div className="pipeline-row-id" title={assembly.id}>
          {assembly.id.slice(0, 8)}
        </div>
        <div className="pipeline-row-stages" aria-label={`Pipeline stage: ${STAGE_LABEL[assembly.stage]}`}>
          {STAGE_ORDER.map((s, i) => {
            const past = !failed && i < currentIdx
            const at = !failed && i === currentIdx
            return (
              <span
                key={s}
                className={`pipeline-stage-dot${past ? ' pipeline-stage-dot--past' : ''}${at ? ' pipeline-stage-dot--current' : ''}`}
                title={STAGE_LABEL[s]}
              >
                {past ? <CheckCircle2 size={10} /> : at ? <Hourglass size={10} /> : <span aria-hidden="true">○</span>}
              </span>
            )
          })}
          {failed && (
            <span className="pipeline-stage-dot pipeline-stage-dot--failed" title="Failed">
              <XCircle size={11} />
            </span>
          )}
        </div>
        <div className="pipeline-row-stage-label">{STAGE_LABEL[assembly.stage]}</div>
        <div className="pipeline-row-time">{new Date(assembly.updated_at).toLocaleString()}</div>
        <ChevronRight size={14} className={`pipeline-row-chevron${expanded ? ' pipeline-row-chevron--open' : ''}`} />
      </button>

      {expanded && (
        <div className="pipeline-row-body">
          {assembly.error && (
            <div className="mm-auth-alert mm-auth-alert--error" role="alert" style={{ marginBottom: 10 }}>
              <AlertCircle size={14} />
              <span>{assembly.error}</span>
            </div>
          )}

          <div className="pipeline-row-actions">
            {!delivered && (
              <button type="button" className="slack-button" disabled={busy} onClick={onRun} style={{ padding: '5px 12px', fontSize: 12 }}>
                {busy ? (<><Loader2 size={12} className="spin" /> Running…</>) : (<><Play size={12} /> {failed ? 'Resume from last good stage' : `Run next stage (→ ${STAGE_LABEL[STAGE_ORDER[currentIdx + 1] || 'delivered']})`}</>)}
              </button>
            )}
            {onDownload && (
              <button type="button" className="ghost-button" onClick={onDownload} style={{ padding: '5px 12px', fontSize: 12 }}>
                <Download size={12} /> Download PDF
              </button>
            )}
            <button type="button" className="ghost-button" onClick={onDelete} style={{ padding: '5px 12px', fontSize: 12, color: 'var(--aae-danger, #d24b4e)' }}>
              Discard
            </button>
            {assembly.ticket_id && (
              <a href={`/home?module=tickets&ticket=${encodeURIComponent(assembly.ticket_id)}`} className="ghost-button" style={{ padding: '5px 12px', fontSize: 12, textDecoration: 'none' }}>
                View ticket
              </a>
            )}
          </div>

          {/* Per-stage log */}
          {log === undefined ? (
            <div className="module-panel-loading" style={{ marginTop: 8 }}>
              <Loader2 size={14} className="spin" /> Loading log…
            </div>
          ) : log.length === 0 ? (
            <p className="doc-muted" style={{ marginTop: 8, fontSize: 12 }}>No stage history yet — pipeline has not run.</p>
          ) : (
            <div className="puzzle-stage-list" style={{ marginTop: 8 }}>
              {log.map(entry => (
                <div
                  key={entry.id}
                  className={`puzzle-stage-row${entry.status === 'ok' ? ' puzzle-stage-row--ok' : ''}${entry.status === 'failed' ? ' puzzle-stage-row--failed' : ''}`}
                >
                  <strong style={{ minWidth: 90 }}>{STAGE_LABEL[entry.stage] || entry.stage}</strong>
                  <span style={{ minWidth: 60, color: entry.status === 'ok' ? '#16a34a' : entry.status === 'failed' ? '#dc2626' : 'inherit' }}>
                    {entry.status}
                  </span>
                  <span style={{ minWidth: 60, opacity: 0.7 }}>{entry.duration_ms}ms</span>
                  <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 11, opacity: 0.85 }}>
                    {Object.keys(entry.detail).length === 0 ? '—' : JSON.stringify(entry.detail)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  )
}
