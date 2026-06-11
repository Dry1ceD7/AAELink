'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bookmark, BookmarkPlus, X, Check, Bell, BellOff } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'

export interface SavedSearch {
  id: string
  workspace_id: string
  name: string
  query: string
  filters: Record<string, unknown>
  alerts_enabled: boolean
  created_at: number
  updated_at: number
}

interface Props {
  /** Workspace whose saved searches are listed. */
  workspaceId: string
  /** Re-runnable: shown the modal is open. */
  open: boolean
  /** Current search query string (filters are embedded in this string). */
  currentQuery: string
  /** Parsed filters for the current query, persisted alongside the query. */
  currentFilters: Record<string, unknown>
  /** Apply a saved search — sets the query so the modal re-runs the search. */
  onApply: (query: string) => void
}

export function SavedSearches({ workspaceId, open, currentQuery, currentFilters, onApply }: Props) {
  const [items, setItems] = useState<SavedSearch[]>([])
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!workspaceId) return
    const params = new URLSearchParams({ workspace_id: workspaceId })
    const res = await apiFetch(`/api/saved-searches?${params.toString()}`)
    if (res.ok) {
      const data = (await res.json()) as { saved_searches?: SavedSearch[] }
      setItems(data.saved_searches ?? [])
    }
  }, [workspaceId])

  useEffect(() => {
    if (open) { void load(); setSaving(false); setName('') }
  }, [open, load])

  useEffect(() => {
    if (saving) setTimeout(() => nameRef.current?.focus(), 10)
  }, [saving])

  const submitSave = useCallback(async () => {
    const trimmedName = name.trim()
    const trimmedQuery = currentQuery.trim()
    if (!trimmedName || !trimmedQuery || busy) return
    setBusy(true)
    const res = await apiFetch('/api/saved-searches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: workspaceId,
        name: trimmedName,
        query: trimmedQuery,
        filters: currentFilters,
      }),
    })
    setBusy(false)
    if (res.ok) {
      const data = (await res.json()) as { saved_search?: SavedSearch }
      if (data.saved_search) setItems(prev => [data.saved_search!, ...prev])
      setSaving(false)
      setName('')
    }
  }, [name, currentQuery, currentFilters, workspaceId, busy])

  const remove = useCallback(async (id: string) => {
    if (busy) return
    setBusy(true)
    const res = await apiFetch('/api/saved-searches', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setBusy(false)
    if (res.ok) setItems(prev => prev.filter(s => s.id !== id))
  }, [busy])

  // Toggle "alert me on new matches" for a saved search. Owner-only is enforced
  // server-side; the worker re-runs alerts_enabled searches and notifies on new
  // matches (BLUEPRINT §2.1.4). Optimistic flip, rolled back on failure.
  const toggleAlerts = useCallback(async (id: string, next: boolean) => {
    if (busy) return
    setBusy(true)
    setItems(prev => prev.map(s => (s.id === id ? { ...s, alerts_enabled: next } : s)))
    const res = await apiFetch('/api/saved-searches', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, alerts_enabled: next }),
    })
    setBusy(false)
    if (!res.ok) {
      setItems(prev => prev.map(s => (s.id === id ? { ...s, alerts_enabled: !next } : s)))
    }
  }, [busy])

  const canSave = currentQuery.trim().length > 0

  return (
    <div className="saved-searches">
      <div className="saved-searches-head">
        <span className="saved-searches-label">
          <Bookmark size={12} aria-hidden="true" /> Saved searches
        </span>
        {!saving && (
          <button
            type="button"
            className="saved-searches-add"
            disabled={!canSave}
            onClick={() => setSaving(true)}
            aria-label="Save current search"
            title={canSave ? 'Save current search' : 'Enter a search to save'}
          >
            <BookmarkPlus size={13} aria-hidden="true" /> Save search
          </button>
        )}
      </div>

      {saving && (
        <form
          className="saved-searches-form"
          onSubmit={e => { e.preventDefault(); void submitSave() }}
        >
          <label className="sr-only" htmlFor="saved-search-name">Saved search name</label>
          <input
            ref={nameRef}
            id="saved-search-name"
            className="saved-searches-name-input"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setSaving(false); setName('') } }}
            placeholder="Name this search…"
            maxLength={120}
            autoComplete="off"
          />
          <button
            type="submit"
            className="saved-searches-confirm"
            disabled={!name.trim() || busy}
            aria-label="Confirm save"
          >
            <Check size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="saved-searches-cancel"
            onClick={() => { setSaving(false); setName('') }}
            aria-label="Cancel save"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </form>
      )}

      {items.length > 0 && (
        <ul className="saved-searches-list" aria-label="Your saved searches">
          {items.map(s => (
            <li key={s.id} className="saved-searches-item">
              <button
                type="button"
                className="saved-searches-item-apply"
                onClick={() => onApply(s.query)}
                title={s.query}
              >
                {s.name}
              </button>
              <button
                type="button"
                className={`saved-searches-item-alert${s.alerts_enabled ? ' saved-searches-item-alert--on' : ''}`}
                onClick={() => void toggleAlerts(s.id, !s.alerts_enabled)}
                aria-pressed={s.alerts_enabled}
                aria-label={s.alerts_enabled
                  ? `Turn off alerts for ${s.name}`
                  : `Alert me on new matches for ${s.name}`}
                title={s.alerts_enabled ? 'Alerts on — click to turn off' : 'Alert me on new matches'}
              >
                {s.alerts_enabled
                  ? <Bell size={12} aria-hidden="true" />
                  : <BellOff size={12} aria-hidden="true" />}
              </button>
              <button
                type="button"
                className="saved-searches-item-remove"
                onClick={() => void remove(s.id)}
                aria-label={`Delete saved search ${s.name}`}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
