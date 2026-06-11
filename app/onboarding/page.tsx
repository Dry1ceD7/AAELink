'use client'

import Image from 'next/image'
import { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api/apiClient'
import { buildHomePathForTeam, rememberWorkspaceTeam } from '@/lib/workspace/workspaceNav'

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
    const res = await apiFetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: displayName.trim(),
        name: urlName.trim() || undefined
      })
    })
    setBusy(false)
    if (!res.ok) {
      setError('Workspace could not be created. Sign in again or ask an admin for permission to create workspaces.')
      return
    }
    const data = await res.json()
    const id = data?.team?.id as string | undefined
    if (id) rememberWorkspaceTeam(id)
    router.replace(id ? buildHomePathForTeam(id) : '/workspaces')
  }

  return (
    <main className="aae-auth-page">
      <div className="aae-auth-card aae-auth-card--wide">
        <form className="slack-card mm-auth-form" onSubmit={submit} style={{ padding: '28px 32px' }}>
          <div className="aae-auth-brand">
            <Image
              src="/brand/aae-logo.png"
              alt=""
              width={120}
              height={120}
              className="aae-auth-logo"
              style={{ width: 'min(120px, 40vw)' }}
            />
            <p className="aae-auth-company">Advanced ID Asia Engineering Co., Ltd</p>
            <p className="aae-auth-product">AAELink</p>
          </div>
          <h1 className="aae-auth-title">
            Create workspace
          </h1>
          <p className="aae-auth-lead">
            A workspace groups channels, messages, and day-to-day collaboration for your team. It appears in your workspace list after you create it.
          </p>
          <label className="field-label" htmlFor="aae-onboard-display">
            Workspace name
            <input
              id="aae-onboard-display"
              className="slack-input"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="e.g. AAELink Operations"
              required
            />
          </label>
          <label className="field-label" htmlFor="aae-onboard-slug">
            URL slug (optional)
            <input
              id="aae-onboard-slug"
              className="slack-input"
              value={urlName}
              onChange={e => setUrlName(e.target.value)}
              placeholder="Lowercase letters, numbers, hyphens"
            />
          </label>
          {error ? (
            <div className="mm-auth-alert mm-auth-alert--error" role="alert" style={{ marginTop: 12 }}>
              <AlertCircle size={18} strokeWidth={2} aria-hidden />
              <span>{error}</span>
            </div>
          ) : null}
          <button className="slack-button mm-auth-submit" type="submit" style={{ width: '100%' }} disabled={busy}>
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
      </div>
    </main>
  )
}
