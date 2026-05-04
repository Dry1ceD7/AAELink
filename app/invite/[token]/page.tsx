'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, CheckCircle, Link2 } from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'

export default function InvitePage() {
  const params = useParams()
  const router = useRouter()
  const token = typeof params.token === 'string' ? params.token : ''
  const [state, setState] = useState<'loading' | 'ready' | 'joining' | 'done' | 'error'>('loading')
  const [wsName, setWsName] = useState('')
  const [err, setErr] = useState('')

  const resolve = useCallback(async () => {
    if (!token) { setState('error'); setErr('No invite token found.'); return }
    const res = await apiFetch(`/api/workspaces/invite?token=${encodeURIComponent(token)}`)
    if (res.status === 410) { setState('error'); setErr('This invitation has expired.'); return }
    if (!res.ok) { setState('error'); setErr('Invalid or unknown invitation link.'); return }
    const data = (await res.json()) as { workspace_name?: string }
    setWsName(data.workspace_name || 'workspace')
    setState('ready')
  }, [token])

  useEffect(() => { void resolve() }, [resolve])

  async function accept() {
    setState('joining')
    const res = await apiFetch('/api/workspaces/invite', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    })
    if (!res.ok) {
      if (res.status === 401) {
        router.push(`/login?next=/invite/${token}`)
        return
      }
      setState('error')
      setErr('Failed to join. Please try again or contact your admin.')
      return
    }
    setState('done')
    setTimeout(() => router.push('/home'), 1800)
  }

  return (
    <main className="aae-auth-page">
      <div className="aae-auth-card">
        <div className="slack-card mm-auth-form" style={{ padding: '32px', textAlign: 'center', maxWidth: 440 }}>
          <Link2 size={36} style={{ color: 'var(--aae-navy)', marginBottom: 16 }} />

          {state === 'loading' && (
            <>
              <h1 className="aae-auth-title">Checking invitation…</h1>
              <p className="aae-auth-lead">Please wait</p>
            </>
          )}

          {state === 'ready' && (
            <>
              <h1 className="aae-auth-title">You&apos;re invited!</h1>
              <p className="aae-auth-lead" style={{ marginBottom: 20 }}>
                You&apos;ve been invited to join <strong>{wsName}</strong> on AAELink.
              </p>
              <button
                type="button"
                className="slack-button"
                style={{ fontSize: 15, padding: '10px 32px' }}
                onClick={() => void accept()}>
                Accept &amp; Join
              </button>
              <p style={{ marginTop: 12, fontSize: 12, color: 'var(--mm-muted)' }}>
                You must be logged in. Not registered? <Link href="/register" className="link-button">Create an account</Link>
              </p>
            </>
          )}

          {state === 'joining' && (
            <>
              <h1 className="aae-auth-title">Joining workspace…</h1>
              <p className="aae-auth-lead">Setting up your membership</p>
            </>
          )}

          {state === 'done' && (
            <>
              <CheckCircle size={36} style={{ color: 'var(--mm-online)', marginBottom: 12 }} />
              <h1 className="aae-auth-title">Welcome aboard!</h1>
              <p className="aae-auth-lead">
                You&apos;re now a member of <strong>{wsName}</strong>. Redirecting…
              </p>
            </>
          )}

          {state === 'error' && (
            <>
              <AlertCircle size={36} style={{ color: '#d24b4e', marginBottom: 12 }} />
              <h1 className="aae-auth-title">Invitation problem</h1>
              <p className="aae-auth-lead" style={{ marginBottom: 16 }}>{err}</p>
              <Link href="/home" className="slack-button" style={{ display: 'inline-block' }}>
                Go to AAELink
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
