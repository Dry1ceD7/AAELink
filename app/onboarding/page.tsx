'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function OnboardingPage() {
  const router = useRouter()
  const [displayName, setDisplayName] = useState('')
  const [urlName, setUrlName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const res = await fetch('/api/mattermost/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: displayName.trim(),
        name: urlName.trim() || undefined
      })
    })
    setBusy(false)
    if (!res.ok) {
      setError('Workspace could not be created. You may need a Mattermost account with permission to create teams.')
      return
    }
    const data = await res.json()
    const id = data?.team?.id as string | undefined
    if (id && typeof window !== 'undefined') {
      sessionStorage.setItem('aaelink_last_team', id)
    }
    router.replace(id ? `/home?team=${encodeURIComponent(id)}` : '/workspaces')
  }

  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#1a1d21' }}>
      <form className="slack-card" onSubmit={submit} style={{ width: 520, padding: 32 }}>
        <h1 style={{ marginTop: 0 }}>Create workspace</h1>
        <p style={{ color: '#616061' }}>Creates a Mattermost team that appears in your workspace list.</p>
        <label className="field-label" style={{ marginTop: 8 }}>
          Workspace name
          <input
            className="slack-input"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="e.g. AAELink Operations"
            required
          />
        </label>
        <label className="field-label" style={{ marginTop: 14 }}>
          URL slug (optional)
          <input
            className="slack-input"
            value={urlName}
            onChange={e => setUrlName(e.target.value)}
            placeholder="Lowercase letters, numbers, hyphens"
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="slack-button" type="submit" style={{ width: '100%', marginTop: 20 }} disabled={busy}>
          {busy ? 'Creating' : 'Create workspace'}
        </button>
        <button
          type="button"
          className="ghost-button"
          style={{ width: '100%', marginTop: 10 }}
          onClick={() => router.push('/workspaces')}
        >
          Cancel
        </button>
      </form>
    </main>
  )
}
