'use client'

import Image from 'next/image'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { apiFetch } from '@/lib/apiClient'
import {
  buildHomePathForTeam,
  clearRememberedWorkspaceTeam,
  readRememberedWorkspaceTeam,
  rememberWorkspaceTeam
} from '@/lib/workspaceNav'

interface Team {
  id: string
  display_name: string
  name: string
  is_system?: boolean
}

export default function WorkspacesPage() {
  const router = useRouter()
  const [teams, setTeams] = useState<Team[]>([])
  const [pendingRemoveTeam, setPendingRemoveTeam] = useState<Team | null>(null)
  const [pendingRemoveBusy, setPendingRemoveBusy] = useState(false)
  const [removeFeedbackError, setRemoveFeedbackError] = useState<string | null>(null)
  const priorFocusBeforeRemoveRef = useRef<HTMLElement | null>(null)
  const removePanelRef = useRef<HTMLDivElement>(null)
  const removeCancelRef = useRef<HTMLButtonElement>(null)

  const load = useCallback(() => {
    return apiFetch('/api/workspaces', { method: 'GET' })
      .then(r => {
        if (r.status === 401) {
          router.replace('/login')
          return null
        }
        return r.ok ? r.json() : Promise.reject()
      })
      .then(data => {
        if (data) setTeams(data.teams ?? [])
      })
      .catch(() => router.replace('/login'))
  }, [router])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (pendingRemoveTeam == null) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = window.setTimeout(() => removeCancelRef.current?.focus(), 0)
    return () => {
      window.clearTimeout(t)
      document.body.style.overflow = prev
    }
  }, [pendingRemoveTeam])

  useLayoutEffect(() => {
    if (pendingRemoveTeam !== null) return
    const el = priorFocusBeforeRemoveRef.current
    priorFocusBeforeRemoveRef.current = null
    if (!el || !document.contains(el)) return
    try {
      el.focus({ preventScroll: true })
    } catch {
      /* ignore */
    }
  }, [pendingRemoveTeam])

  useEffect(() => {
    const panel = removePanelRef.current
    if (!panel || pendingRemoveTeam == null) return

    const focusables = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter(el => el.offsetParent !== null || el === document.activeElement)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const active = document.activeElement
      if (!active || !panel.contains(active)) return
      const nodes = focusables()
      if (nodes.length === 0) return
      if (nodes.length === 1) {
        e.preventDefault()
        nodes[0].focus()
        return
      }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (e.shiftKey) {
        if (active === first) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [pendingRemoveTeam, pendingRemoveBusy])

  const cancelPendingRemove = useCallback(() => {
    if (pendingRemoveBusy) return
    setRemoveFeedbackError(null)
    setPendingRemoveTeam(null)
  }, [pendingRemoveBusy])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (pendingRemoveTeam) {
        cancelPendingRemove()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingRemoveTeam, cancelPendingRemove])

  const requestRemoveWorkspace = useCallback((t: Team) => {
    if (t.is_system) return
    setRemoveFeedbackError(null)
    const a = document.activeElement
    priorFocusBeforeRemoveRef.current = a instanceof HTMLElement ? a : null
    setPendingRemoveTeam(t)
  }, [])

  const performRemoveWorkspace = useCallback(async () => {
    const t = pendingRemoveTeam
    if (!t || t.is_system) return
    setPendingRemoveBusy(true)
    setRemoveFeedbackError(null)
    try {
      const res = await apiFetch(`/api/workspaces/${encodeURIComponent(t.id)}`, { method: 'DELETE' })
      if (res.status === 403) {
        setRemoveFeedbackError('This workspace cannot be removed.')
        return
      }
      if (!res.ok) {
        setRemoveFeedbackError('Could not remove workspace.')
        return
      }
      setTeams(cur => {
        const next = cur.filter(x => x.id !== t.id)
        if (readRememberedWorkspaceTeam() === t.id) {
          const fallback = next[0]?.id
          if (fallback) rememberWorkspaceTeam(fallback)
          else clearRememberedWorkspaceTeam()
        }
        return next
      })
      setPendingRemoveTeam(null)
    } finally {
      setPendingRemoveBusy(false)
    }
  }, [pendingRemoveTeam])

  function openWorkspace(team: Team) {
    rememberWorkspaceTeam(team.id)
    router.push(buildHomePathForTeam(team.id))
  }

  return (
    <>
      <main className="aae-auth-page" inert={pendingRemoveTeam != null ? true : undefined}>
        <div className="aae-auth-card aae-auth-card--wide">
          <section className="slack-card mm-auth-form" style={{ padding: 'clamp(18px, 4vw, 28px) clamp(14px, 4vw, 32px)' }}>
            <div className="aae-auth-brand">
              <Image
                src="/brand/aae-logo.png"
                alt=""
                width={100}
                height={100}
                className="aae-auth-logo aae-auth-logo--standalone"
                style={{ width: 'min(100px, 36vw)' }}
              />
              <p className="aae-auth-company">Advanced ID Asia Engineering Co., Ltd</p>
              <p className="aae-auth-product">AAELink</p>
            </div>
            <h1 className="aae-auth-title">Workspaces</h1>
            <p className="aae-auth-lead">Open a workspace to continue. Add workspaces below; account options are in Settings.</p>
            {teams.length === 0 ? (
              <Link className="slack-button" href="/onboarding" style={{ display: 'inline-block' }}>
                Create workspace
              </Link>
            ) : (
              <div className="aae-ws-list">
                {teams.map(team => (
                  <div key={team.id} className="aae-ws-row">
                    <div className="aae-ws-row-main">
                      <button type="button" className="aae-ws-open" onClick={() => openWorkspace(team)}>
                        <span className="aae-ws-open-title">
                          {team.display_name}
                          {team.is_system ? (
                            <span className="aae-ws-hub-badge" aria-label="System hub">
                              Hub
                            </span>
                          ) : null}
                        </span>
                        <span className="aae-ws-open-sub">{team.name}</span>
                      </button>
                    </div>
                    {!team.is_system ? (
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={pendingRemoveTeam?.id === team.id && pendingRemoveBusy}
                        onClick={() => requestRemoveWorkspace(team)}
                        style={{ fontSize: 13, padding: '6px 10px' }}
                      >
                        {pendingRemoveTeam?.id === team.id && pendingRemoveBusy ? '…' : 'Remove'}
                      </button>
                    ) : (
                      <span className="aae-ws-row-spacer" aria-hidden="true" />
                    )}
                  </div>
                ))}
              </div>
            )}
            <p style={{ marginTop: 22 }}>
              <Link className="slack-button" href="/onboarding" style={{ display: 'inline-block' }}>
                Add a workspace
              </Link>
            </p>
            <p className="aae-auth-footer" style={{ marginTop: 20 }}>
              <Link href="/settings">Settings</Link>
              {' · '}
              <button
                type="button"
                className="aae-auth-inline-link"
                onClick={() => {
                  void apiFetch('/api/auth/logout', { method: 'POST' }).then(() => {
                    window.location.href = '/login'
                  })
                }}
              >
                Sign out
              </button>
            </p>
          </section>
        </div>
      </main>

      {pendingRemoveTeam && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="mm-modal-overlay"
              role="presentation"
              onClick={() => {
                if (!pendingRemoveBusy) cancelPendingRemove()
              }}
            >
              <div
                ref={removePanelRef}
                className="mm-modal"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="ws-remove-title"
                aria-describedby="ws-remove-desc"
                onClick={e => e.stopPropagation()}
              >
                <h2 id="ws-remove-title">Remove workspace?</h2>
                <p id="ws-remove-desc" className="mm-editor-hint" style={{ marginTop: 8 }}>
                  Remove &quot;{pendingRemoveTeam.display_name}&quot;. This cannot be undone.
                </p>
                {removeFeedbackError ? (
                  <p className="form-error" role="alert" style={{ marginTop: 10 }}>
                    {removeFeedbackError}
                  </p>
                ) : null}
                <div className="mm-modal-actions">
                  <button
                    ref={removeCancelRef}
                    type="button"
                    className="ghost-button"
                    disabled={pendingRemoveBusy}
                    onClick={cancelPendingRemove}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="slack-button"
                    disabled={pendingRemoveBusy}
                    onClick={() => void performRemoveWorkspace()}
                  >
                    {pendingRemoveBusy ? 'Removing' : 'Remove workspace'}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
