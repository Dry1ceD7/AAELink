'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/mattermost/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login_id: loginId, password })
    })
    setLoading(false)
    if (!res.ok) {
      setError('Sign-in failed.')
      return
    }
    router.replace('/workspaces')
  }

  return (
    <main style={{
      minHeight: '100dvh',
      display: 'grid',
      placeItems: 'center',
      background: 'linear-gradient(135deg, #350d36, #4a154b 45%, #1a1d21)'
    }}>
      <form className="slack-card" onSubmit={submit} style={{ width: 420, padding: 32 }}>
        <h1 style={{ margin: 0, fontSize: 32 }}>Sign in to AAELink</h1>
        <p style={{ color: '#616061' }}>Mattermost-backed secure workspace.</p>
        <label>Email or username</label>
        <input className="slack-input" value={loginId} onChange={e => setLoginId(e.target.value)} />
        <div style={{ height: 14 }} />
        <label>Password</label>
        <input className="slack-input" type="password" value={password} onChange={e => setPassword(e.target.value)} />
        {error && <p style={{ color: '#e01e5a' }}>{error}</p>}
        <button className="slack-button" style={{ width: '100%', marginTop: 20 }}>
          {loading ? 'Signing in...' : 'Continue'}
        </button>
      </form>
    </main>
  )
}
