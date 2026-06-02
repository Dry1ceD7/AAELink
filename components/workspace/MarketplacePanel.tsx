'use client'

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Search, Download, Star, CheckCircle, Puzzle, ExternalLink, Loader2, Package, Share2, Trash2 } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { TabList } from '@/components/a11y'

/* ────────────────────────────────────────────────────────────────────────── */
/* Types                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */
export interface MarketplacePlugin {
  id: string
  name: string
  slug: string
  description: string
  version: string
  author: string
  icon_emoji: string
  icon_bg: string
  category: string
  downloads: number
  rating: number
  workspace_id: string
  is_published: boolean
  created_by: string
  created_at: number
  updated_at: number
}

export interface InstalledPlugin {
  plugin_id: string
  installed_at: number
  enabled: boolean
}

type Category = 'all' | 'productivity' | 'communication' | 'developer' | 'analytics' | 'hr' | 'security' | 'other'

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'communication', label: 'Communication' },
  { id: 'developer', label: 'Developer Tools' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'hr', label: 'HR & People' },
  { id: 'security', label: 'Security' },
  { id: 'other', label: 'Other' }
]

/* ────────────────────────────────────────────────────────────────────────── */
/* Marketplace Panel                                                         */
/* ────────────────────────────────────────────────────────────────────────── */
export const MarketplacePanel = memo(function MarketplacePanel({ workspaceId }: { workspaceId: string }) {
  const [plugins, setPlugins] = useState<MarketplacePlugin[]>([])
  const [installed, setInstalled] = useState<Record<string, InstalledPlugin>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<Category>('all')
  const [tab, setTab] = useState<'browse' | 'installed' | 'publish'>('browse')
  const [actionBusy, setActionBusy] = useState<string | null>(null)

  // Publish form
  const [pubName, setPubName] = useState('')
  const [pubSlug, setPubSlug] = useState('')
  const [pubDesc, setPubDesc] = useState('')
  const [pubVersion, setPubVersion] = useState('1.0.0')
  const [pubEmoji, setPubEmoji] = useState('⬡')
  const [pubBg, setPubBg] = useState('#5865f2')
  const [pubCat, setPubCat] = useState<string>('other')
  const [pubErr, setPubErr] = useState('')
  const [pubOk, setPubOk] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [pRes, iRes] = await Promise.all([
        apiFetch(`/api/marketplace/plugins?workspace_id=${workspaceId}`),
        apiFetch(`/api/marketplace/installed?workspace_id=${workspaceId}`)
      ])
      if (pRes.ok) {
        const d = await pRes.json() as { plugins: MarketplacePlugin[] }
        setPlugins(d.plugins || [])
      }
      if (iRes.ok) {
        const d = await iRes.json() as { installed: InstalledPlugin[] }
        const map: Record<string, InstalledPlugin> = {}
        for (const ip of (d.installed || [])) map[ip.plugin_id] = ip
        setInstalled(map)
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [workspaceId])

  useEffect(() => { void loadData() }, [loadData])

  const filtered = useMemo(() => {
    let list = plugins
    if (category !== 'all') list = list.filter(p => p.category === category)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(p => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.author.toLowerCase().includes(q))
    }
    if (tab === 'installed') list = list.filter(p => installed[p.id])
    return list
  }, [plugins, category, search, tab, installed])

  async function handleInstall(pluginId: string) {
    setActionBusy(pluginId)
    try {
      const res = await apiFetch('/api/marketplace/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, plugin_id: pluginId })
      })
      if (res.ok) {
        setInstalled(prev => ({ ...prev, [pluginId]: { plugin_id: pluginId, installed_at: Date.now(), enabled: true } }))
      }
    } catch { /* ignore */ }
    setActionBusy(null)
  }

  async function handleUninstall(pluginId: string) {
    setActionBusy(pluginId)
    try {
      const res = await apiFetch(`/api/marketplace/install?workspace_id=${workspaceId}&plugin_id=${pluginId}`, {
        method: 'DELETE'
      })
      if (res.ok) {
        setInstalled(prev => { const next = { ...prev }; delete next[pluginId]; return next })
      }
    } catch { /* ignore */ }
    setActionBusy(null)
  }

  async function handlePublish(e: React.FormEvent) {
    e.preventDefault()
    setPubErr('')
    setPubOk('')
    if (!pubName.trim() || !pubSlug.trim() || !pubDesc.trim()) {
      setPubErr('Name, slug, and description are required.')
      return
    }
    setActionBusy('publish')
    try {
      const res = await apiFetch('/api/marketplace/plugins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          name: pubName.trim(),
          slug: pubSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
          description: pubDesc.trim(),
          version: pubVersion.trim() || '1.0.0',
          icon_emoji: pubEmoji || '⬡',
          icon_bg: pubBg || '#5865f2',
          category: pubCat || 'other'
        })
      })
      if (res.ok) {
        setPubOk('Plugin published! It is now available in the marketplace.')
        setPubName('')
        setPubSlug('')
        setPubDesc('')
        setPubVersion('1.0.0')
        void loadData()
      } else {
        const d = await res.json().catch(() => ({})) as { error?: string }
        setPubErr(d.error || 'Failed to publish.')
      }
    } catch {
      setPubErr('Network error.')
    }
    setActionBusy(null)
  }

  return (
    <div className="marketplace-panel">
      <TabList
        tabs={[
          { id: 'browse', label: <><Package size={14} /> Browse</> },
          {
            id: 'installed',
            label: (
              <>
                <CheckCircle size={14} /> Installed
                <span className="marketplace-installed-badge">
                  {Object.keys(installed).length}
                </span>
              </>
            ),
          },
          { id: 'publish', label: <><Share2 size={14} /> Publish Plugin</> },
        ]}
        value={tab}
        onChange={id => setTab(id as 'browse' | 'installed' | 'publish')}
        ariaLabel="Marketplace sections"
        idPrefix="marketplace"
        className="aae-tab-bar aae-tab-bar--marketplace"
      />

      {tab === 'publish' ? (
        /* ── Publish form ────────────────────────────────────── */
        <form onSubmit={handlePublish} className="marketplace-publish-form">
          <p className="marketplace-publish-desc">
            Publish a plugin to the marketplace. Other users in this workspace can install it.
          </p>
          <div className="mm-settings-form-row">
            <label className="mm-settings-form-label" htmlFor="pub-name">Plugin Name</label>
            <input id="pub-name" className="mm-settings-input" value={pubName}
              onChange={e => setPubName(e.target.value)} maxLength={128} placeholder="My Cool Plugin" />
          </div>
          <div className="mm-settings-form-row">
            <label className="mm-settings-form-label" htmlFor="pub-slug">Slug</label>
            <input id="pub-slug" className="mm-settings-input" value={pubSlug}
              onChange={e => setPubSlug(e.target.value)} maxLength={64} placeholder="my-cool-plugin" />
          </div>
          <div className="mm-settings-form-row">
            <label className="mm-settings-form-label" htmlFor="pub-desc">Description</label>
            <textarea id="pub-desc" className="mm-settings-input marketplace-publish-textarea" value={pubDesc} rows={3}
              onChange={e => setPubDesc(e.target.value)} maxLength={500} placeholder="What does your plugin do?" />
          </div>
          <div className="marketplace-publish-row">
            <div className="mm-settings-form-row marketplace-publish-field">
              <label className="mm-settings-form-label" htmlFor="pub-version">Version</label>
              <input id="pub-version" className="mm-settings-input" value={pubVersion}
                onChange={e => setPubVersion(e.target.value)} maxLength={16} placeholder="1.0.0" />
            </div>
            <div className="mm-settings-form-row marketplace-publish-field">
              <label className="mm-settings-form-label" htmlFor="pub-cat">Category</label>
              <select id="pub-cat" className="mm-settings-input" value={pubCat}
                onChange={e => setPubCat(e.target.value)}>
                {CATEGORIES.filter(c => c.id !== 'all').map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="marketplace-publish-row">
            <div className="mm-settings-form-row marketplace-publish-icon-field">
              <label className="mm-settings-form-label" htmlFor="pub-emoji">Icon</label>
              <input id="pub-emoji" className="mm-settings-input marketplace-publish-emoji" value={pubEmoji}
                onChange={e => setPubEmoji(e.target.value)} maxLength={4} />
            </div>
            <div className="mm-settings-form-row marketplace-publish-color-field">
              <label className="mm-settings-form-label" htmlFor="pub-bg">Color</label>
              <input id="pub-bg" type="color" className="marketplace-publish-color" value={pubBg}
                onChange={e => setPubBg(e.target.value)} />
            </div>
          </div>
          {pubErr && <div className="mm-auth-alert mm-auth-alert--error marketplace-publish-alert" role="alert"><span>{pubErr}</span></div>}
          {pubOk && <div className="mm-auth-alert mm-auth-alert--success marketplace-publish-alert" role="status"><CheckCircle size={14} /><span>{pubOk}</span></div>}
          <div className="marketplace-publish-submit">
            <button type="submit" className="slack-button" disabled={actionBusy === 'publish'}>
              {actionBusy === 'publish' ? <><Loader2 size={14} className="spin" /> Publishing…</> : <><Share2 size={14} /> Publish to Marketplace</>}
            </button>
          </div>
        </form>
      ) : (
        /* ── Browse / Installed ──────────────────────────────── */
        <>
          {/* Search + categories */}
          <div className="marketplace-search-bar">
            <div className="marketplace-search-wrap">
              <Search size={16} className="marketplace-search-icon" />
              <input type="text" className="marketplace-search-input"
                placeholder="Search plugins…" value={search}
                onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          {tab === 'browse' && (
            <div className="marketplace-category-pills">
              {CATEGORIES.map(c => (
                <button key={c.id} type="button"
                  className={`marketplace-category-pill${category === c.id ? ' active' : ''}`}
                  onClick={() => setCategory(c.id)}>
                  {c.label}
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <div className="marketplace-empty">
              <Loader2 size={28} className="spin" />
              <p>Loading marketplace…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="marketplace-empty">
              <Puzzle size={40} strokeWidth={1.5} />
              <p>{tab === 'installed' ? 'No plugins installed yet.' : 'No plugins found.'}</p>
            </div>
          ) : (
            <div className="marketplace-grid">
              {filtered.map(p => {
                const isInstalled = Boolean(installed[p.id])
                const busy = actionBusy === p.id
                return (
                  <div key={p.id} className="marketplace-card">
                    <div className="marketplace-card-header">
                      <div className="marketplace-card-icon" style={{ background: p.icon_bg || '#5865f2' }}>
                        {p.icon_emoji || '⬡'}
                      </div>
                      <div>
                        <div className="marketplace-card-title">{p.name}</div>
                        <div className="marketplace-card-author">by {p.author}</div>
                      </div>
                    </div>
                    <div className="marketplace-card-desc">{p.description}</div>
                    <div className="marketplace-card-footer">
                      <div className="marketplace-card-meta">
                        <span><Download size={11} /> {p.downloads}</span>
                        <span><Star size={11} /> {p.rating.toFixed(1)}</span>
                        <span>v{p.version}</span>
                      </div>
                      {isInstalled ? (
                        <div className="marketplace-card-actions">
                          <button type="button" className="marketplace-install-btn installed" disabled>
                            <CheckCircle size={12} /> Installed
                          </button>
                          <button type="button" className="marketplace-install-btn marketplace-uninstall-btn"
                            onClick={() => void handleUninstall(p.id)} disabled={busy}
                            aria-label={`Uninstall ${p.name}`}>
                            {busy ? <Loader2 size={12} className="spin" /> : <Trash2 size={12} />}
                          </button>
                        </div>
                      ) : (
                        <button type="button" className="marketplace-install-btn"
                          onClick={() => void handleInstall(p.id)} disabled={busy}>
                          {busy ? <Loader2 size={12} className="spin" /> : 'Install'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
})
