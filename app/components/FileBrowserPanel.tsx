'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/apiClient'
import { FolderOpen, Search, X, LayoutGrid, List, Download, FileText, Image, Film, Archive, Code, Table, File, Loader2 } from 'lucide-react'

/* ── File Browser — Wired to /api/documents + /api/files ─────────── */

interface WorkspaceFile {
  id: string
  name: string
  original_name?: string
  type: string
  mime_type?: string
  size: number
  uploaded_by?: string
  channel_name?: string
  created_at: string
}

function getFileType(name: string, mime?: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (mime?.startsWith('image/') || ['png','jpg','jpeg','gif','svg','webp'].includes(ext)) return 'image'
  if (mime?.startsWith('video/') || ['mp4','mov','avi','webm'].includes(ext)) return 'video'
  if (['pdf'].includes(ext)) return 'pdf'
  if (['doc','docx','md','txt','rtf'].includes(ext)) return 'doc'
  if (['zip','tar','gz','7z','rar'].includes(ext)) return 'archive'
  if (['js','ts','py','go','rs','yaml','json','xml','html','css'].includes(ext)) return 'code'
  if (['xls','xlsx','csv'].includes(ext)) return 'spreadsheet'
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

export default function FileBrowserPanel({ onClose }: { onClose: () => void }) {
  const [files, setFiles] = useState<WorkspaceFile[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')

  const TYPES = ['all', 'pdf', 'image', 'doc', 'video', 'archive', 'code', 'spreadsheet']

  const loadFiles = useCallback(async () => {
    try {
      setLoading(true)
      const res = await apiFetch('/api/documents')
      if (res.ok) {
        const data = await res.json()
        setFiles((data.documents || []).map((d: Record<string, string | number>) => ({
          ...d,
          type: getFileType(String(d.original_name || d.name || ''), String(d.mime_type || '')),
        })))
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { loadFiles() }, [loadFiles])

  const filtered = files.filter(f => {
    if (filterType !== 'all' && f.type !== filterType) return false
    const name = f.original_name || f.name
    if (search && !name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--mm-main-bg)', color: 'var(--mm-text)' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #06b6d4, #0891b2)', display: 'grid', placeItems: 'center' }}>
              <FolderOpen size={18} color="#fff" />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Files</h2>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>{files.length} files</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')} style={{ background: 'var(--mm-hover-bg)', border: 'none', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', color: 'var(--mm-text)', display: 'grid', placeItems: 'center' }}>
              {viewMode === 'list' ? <LayoutGrid size={14} /> : <List size={14} />}
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}>
              <X size={18} />
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search files…"
              style={{ width: '100%', padding: '9px 14px 9px 32px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
          {TYPES.map(t => (
            <button key={t} onClick={() => setFilterType(t)} style={{
              padding: '3px 10px', borderRadius: 5, border: 'none', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
              fontWeight: filterType === t ? 700 : 500,
              background: filterType === t ? '#06b6d4' : 'var(--mm-hover-bg)',
              color: filterType === t ? '#fff' : 'var(--mm-text)',
              textTransform: 'capitalize',
            }}>{t}</button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60, opacity: 0.5 }}>
            <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13, marginTop: 8 }}>Loading files…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60, opacity: 0.5 }}>
            <FolderOpen size={36} />
            <span style={{ fontSize: 14, fontWeight: 600, marginTop: 8 }}>No files found</span>
          </div>
        ) : viewMode === 'list' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtered.map(file => {
              const IconComp = TYPE_ICON[file.type] || File
              const color = TYPE_COLOR[file.type] || '#888'
              return (
                <div key={file.id} style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid var(--mm-border)', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', transition: 'background 100ms' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--mm-hover-bg)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: `${color}15`, display: 'grid', placeItems: 'center' }}>
                    <IconComp size={16} style={{ color }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.original_name || file.name}</div>
                    <div style={{ fontSize: 11, opacity: 0.5 }}>{file.uploaded_by || '—'} · {new Date(file.created_at).toLocaleDateString()}</div>
                  </div>
                  <span style={{ fontSize: 11, opacity: 0.4, whiteSpace: 'nowrap' }}>{formatSize(file.size)}</span>
                  <button onClick={() => window.open(`/api/files/${file.id}/download`, '_blank')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)', display: 'grid', placeItems: 'center' }}>
                    <Download size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
            {filtered.map(file => {
              const IconComp = TYPE_ICON[file.type] || File
              const color = TYPE_COLOR[file.type] || '#888'
              return (
                <div key={file.id} style={{ padding: 14, borderRadius: 12, border: '1px solid var(--mm-border)', textAlign: 'center', cursor: 'pointer', transition: 'background 100ms' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--mm-hover-bg)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <IconComp size={28} style={{ color, marginBottom: 8 }} />
                  <div style={{ fontWeight: 600, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.original_name || file.name}</div>
                  <div style={{ fontSize: 10, opacity: 0.4, marginTop: 4 }}>{formatSize(file.size)}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
