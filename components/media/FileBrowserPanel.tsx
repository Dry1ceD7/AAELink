'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api/apiClient'
import { FolderOpen, Search, X, LayoutGrid, List, Download, FileText, Image, Film, Archive, Code, Table, File, Loader2 } from 'lucide-react'

/* ── File Browser — Wired to /api/files (server-side filters) ─────── */

/** Subset of the /api/files serializeFile() shape this panel consumes. */
interface FilesApiFile {
  id: string; name: string; mimetype: string; size: number
  url_private: string; user_name: string; created: number
}
interface WorkspaceFile {
  id: string; name: string; type: string; size: number
  uploaded_by: string; url: string; created: number
}
interface MemberOption { id: string; label: string }
interface ChannelOption { id: string; label: string }

/* UI filter chip → /api/files `types` token. Only the route's first-class
   tokens (images/videos/pdfs/docs/audio) are sent; other chips list everything
   rather than send a token the route can't match against content_type. */
const TYPE_PARAM: Record<string, string> = {
  image: 'images', video: 'videos', pdf: 'pdfs', doc: 'docs', audio: 'audio',
}

const EXT = {
  image: ['png','jpg','jpeg','gif','svg','webp'], video: ['mp4','mov','avi','webm'],
  audio: ['mp3','wav','ogg','m4a'], archive: ['zip','tar','gz','7z','rar'],
  code: ['js','ts','py','go','rs','yaml','json','xml','html','css'], spreadsheet: ['xls','xlsx','csv'],
}

function uiType(mime: string, name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (mime.startsWith('image/') || EXT.image.includes(ext)) return 'image'
  if (mime.startsWith('video/') || EXT.video.includes(ext)) return 'video'
  if (mime.startsWith('audio/') || EXT.audio.includes(ext)) return 'audio'
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (EXT.archive.includes(ext)) return 'archive'
  if (EXT.code.includes(ext)) return 'code'
  if (EXT.spreadsheet.includes(ext)) return 'spreadsheet'
  return 'doc'
}

const TYPE_ICON: Record<string, typeof FileText> = {
  pdf: FileText, image: Image, doc: FileText, video: Film,
  archive: Archive, code: Code, spreadsheet: Table,
}
const TYPE_COLOR: Record<string, string> = {
  pdf: '#e01e5a', image: '#2bac76', doc: '#4361EE', video: '#8b5cf6',
  archive: '#f59e0b', code: '#06b6d4', spreadsheet: '#059669',
}

function formatSize(bytes: number): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

/** A `<input type="date">` value (yyyy-mm-dd) → epoch ms. `end` aligns to day end. */
function dateToMs(value: string, end: boolean): string {
  if (!value) return ''
  const ms = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}`).getTime()
  return Number.isNaN(ms) ? '' : String(ms)
}

const selectStyle = {
  padding: '7px 8px', borderRadius: 8, border: '1px solid var(--mm-border)',
  background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 12,
  outline: 'none', maxWidth: '100%',
} as const

function FileRow({ file }: { file: WorkspaceFile }) {
  const IconComp = TYPE_ICON[file.type] || File
  const color = TYPE_COLOR[file.type] || '#888'
  return (
    <div className="aae-hoverable"
      style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid var(--mm-border)', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: `${color}15`, display: 'grid', placeItems: 'center' }}>
        <IconComp size={16} style={{ color }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
        <div style={{ fontSize: 11, opacity: 0.5 }}>{file.uploaded_by || '—'} · {file.created ? new Date(file.created).toLocaleDateString() : '—'}</div>
      </div>
      <span style={{ fontSize: 11, opacity: 0.4, whiteSpace: 'nowrap' }}>{formatSize(file.size)}</span>
      <button type="button" onClick={() => window.open(file.url, '_blank')} aria-label={`Download ${file.name}`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)', display: 'grid', placeItems: 'center' }}>
        <Download size={14} />
      </button>
    </div>
  )
}

function FileCard({ file }: { file: WorkspaceFile }) {
  const IconComp = TYPE_ICON[file.type] || File
  const color = TYPE_COLOR[file.type] || '#888'
  return (
    <div className="aae-hoverable" onClick={() => window.open(file.url, '_blank')}
      style={{ padding: 14, borderRadius: 12, border: '1px solid var(--mm-border)', textAlign: 'center', cursor: 'pointer' }}>
      <IconComp size={28} style={{ color, marginBottom: 8 }} />
      <div style={{ fontWeight: 600, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
      <div style={{ fontSize: 10, opacity: 0.4, marginTop: 4 }}>{formatSize(file.size)}</div>
    </div>
  )
}

const TYPES = ['all', 'pdf', 'image', 'doc', 'video', 'audio', 'archive', 'code', 'spreadsheet']

interface ToolbarProps {
  count: number
  viewMode: 'list' | 'grid'; onToggleView: () => void; onClose: () => void
  search: string; setSearch: (v: string) => void
  userId: string; setUserId: (v: string) => void; members: MemberOption[]
  channelFilter: string; setChannelFilter: (v: string) => void; channels: ChannelOption[]
  dateFrom: string; setDateFrom: (v: string) => void
  dateTo: string; setDateTo: (v: string) => void
  filterType: string; setFilterType: (v: string) => void
}

/** Header + server-side filter controls (search, pickers, date range, type chips). */
function FilesToolbar(p: ToolbarProps) {
  return (
    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #06b6d4, #0891b2)', display: 'grid', placeItems: 'center' }}>
            <FolderOpen size={18} color="#fff" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Files</h2>
            <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>{p.count} files</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={p.onToggleView} aria-label="Toggle view" style={{ background: 'var(--mm-hover-bg)', border: 'none', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', color: 'var(--mm-text)', display: 'grid', placeItems: 'center' }}>
            {p.viewMode === 'list' ? <LayoutGrid size={14} /> : <List size={14} />}
          </button>
          <button type="button" onClick={p.onClose} aria-label="Close files panel" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}>
            <X size={18} />
          </button>
        </div>
      </div>
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
        <input value={p.search} onChange={e => p.setSearch(e.target.value)} placeholder="Search files…"
          style={{ width: '100%', padding: '9px 14px 9px 32px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
        <select value={p.userId} onChange={e => p.setUserId(e.target.value)} aria-label="Filter by uploader" style={selectStyle}>
          <option value="">All people</option>
          {p.members.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <select value={p.channelFilter} onChange={e => p.setChannelFilter(e.target.value)} aria-label="Filter by channel" style={selectStyle}>
          <option value="">All channels</option>
          {p.channels.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <input type="date" value={p.dateFrom} onChange={e => p.setDateFrom(e.target.value)} aria-label="From date" style={selectStyle} />
        <input type="date" value={p.dateTo} onChange={e => p.setDateTo(e.target.value)} aria-label="To date" style={selectStyle} />
      </div>
      <div style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
        {TYPES.map(t => (
          <button key={t} type="button" onClick={() => p.setFilterType(t)} style={{
            padding: '3px 10px', borderRadius: 5, border: 'none', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
            fontWeight: p.filterType === t ? 700 : 500,
            background: p.filterType === t ? '#06b6d4' : 'var(--mm-hover-bg)',
            color: p.filterType === t ? '#fff' : 'var(--mm-text)', textTransform: 'capitalize',
          }}>{t}</button>
        ))}
      </div>
    </div>
  )
}

interface FileBrowserPanelProps {
  onClose: () => void
  /** Workspace whose members/channels populate the picker dropdowns. */
  workspaceId?: string
  /** Pre-selected channel to scope the listing to (e.g. the open channel). */
  channelId?: string
}

export default function FileBrowserPanel({ onClose, workspaceId, channelId }: FileBrowserPanelProps) {
  const [files, setFiles] = useState<WorkspaceFile[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const [userId, setUserId] = useState('')
  const [channelFilter, setChannelFilter] = useState(channelId || '')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [members, setMembers] = useState<MemberOption[]>([])
  const [channels, setChannels] = useState<ChannelOption[]>([])

  // Keep the channel filter in sync when the host re-opens the panel for a new channel.
  useEffect(() => { setChannelFilter(channelId || '') }, [channelId])

  // Populate the user + channel picker dropdowns from workspace data.
  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    void (async () => {
      const [mRes, cRes] = await Promise.all([
        apiFetch(`/api/collab/workspace-members?workspace_id=${encodeURIComponent(workspaceId)}`),
        apiFetch(`/api/channels?workspace_id=${encodeURIComponent(workspaceId)}`),
      ])
      if (cancelled) return
      if (mRes.ok) {
        const d = (await mRes.json()) as { users?: Array<{ id: string; username?: string; first_name?: string; last_name?: string; nickname?: string }> }
        setMembers((d.users || []).map(u => ({
          id: u.id,
          label: `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.nickname || u.username || u.id,
        })))
      }
      if (cRes.ok) {
        const d = (await cRes.json()) as { channels?: Array<{ id: string; display_name?: string; name?: string; type?: string }> }
        setChannels((d.channels || [])
          .filter(c => c.type !== 'D')
          .map(c => ({ id: c.id, label: c.display_name || c.name || c.id })))
      }
    })()
    return () => { cancelled = true }
  }, [workspaceId])

  const loadFiles = useCallback(async () => {
    try {
      setLoading(true)
      const p = new URLSearchParams()
      if (search) p.set('search', search)
      if (userId) p.set('user_id', userId)
      if (channelFilter) p.set('channel_id', channelFilter)
      if (filterType !== 'all' && TYPE_PARAM[filterType]) p.set('types', TYPE_PARAM[filterType])
      const tsFrom = dateToMs(dateFrom, false)
      const tsTo = dateToMs(dateTo, true)
      if (tsFrom) p.set('ts_from', tsFrom)
      if (tsTo) p.set('ts_to', tsTo)
      const qs = p.toString()
      const res = await apiFetch(`/api/files${qs ? `?${qs}` : ''}`)
      if (res.ok) {
        const data = (await res.json()) as { files?: FilesApiFile[] }
        setFiles((data.files || []).map(f => ({
          id: f.id,
          name: f.name,
          type: uiType(f.mimetype || '', f.name || ''),
          size: Number(f.size) || 0,
          uploaded_by: f.user_name || '',
          url: f.url_private || `/api/files/${f.id}/download`,
          created: Number(f.created) || 0,
        })))
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [search, userId, channelFilter, filterType, dateFrom, dateTo])

  // Debounce so typing in search / picking filters drives a single server query.
  useEffect(() => {
    const t = setTimeout(() => { void loadFiles() }, 250)
    return () => clearTimeout(t)
  }, [loadFiles])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--mm-main-bg)', color: 'var(--mm-text)' }}>
      <FilesToolbar
        count={files.length}
        viewMode={viewMode} onToggleView={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')} onClose={onClose}
        search={search} setSearch={setSearch}
        userId={userId} setUserId={setUserId} members={members}
        channelFilter={channelFilter} setChannelFilter={setChannelFilter} channels={channels}
        dateFrom={dateFrom} setDateFrom={setDateFrom}
        dateTo={dateTo} setDateTo={setDateTo}
        filterType={filterType} setFilterType={setFilterType}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60, opacity: 0.5 }}>
            <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13, marginTop: 8 }}>Loading files…</span>
          </div>
        ) : files.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60, opacity: 0.5 }}>
            <FolderOpen size={36} />
            <span style={{ fontSize: 14, fontWeight: 600, marginTop: 8 }}>No files found</span>
          </div>
        ) : viewMode === 'list' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {files.map(file => <FileRow key={file.id} file={file} />)}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
            {files.map(file => <FileCard key={file.id} file={file} />)}
          </div>
        )}
      </div>
    </div>
  )
}
