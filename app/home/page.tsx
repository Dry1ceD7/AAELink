'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { connectMattermost, disconnectMattermost, type ChatPost } from '@/lib/realtime'

interface Channel {
  id: string
  name: string
  display_name: string
}

interface MMUser {
  id: string
  username: string
  first_name?: string
  last_name?: string
  nickname?: string
}

interface Team {
  id: string
  name: string
  display_name: string
}

const TEAM_KEY = 'aaelink_last_team'

function displayName(u: MMUser) {
  const full = `${u.first_name || ''} ${u.last_name || ''}`.trim()
  if (full) return full
  if (u.nickname) return u.nickname
  return u.username
}

function HomeChat() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [teams, setTeams] = useState<Team[]>([])
  const [activeTeamId, setActiveTeamId] = useState('')
  const [channels, setChannels] = useState<Channel[]>([])
  const [channel, setChannel] = useState<Channel | null>(null)
  const [posts, setPosts] = useState<ChatPost[]>([])
  const [draft, setDraft] = useState('')
  const [online, setOnline] = useState(false)
  const [me, setMe] = useState<MMUser | null>(null)
  const [userMap, setUserMap] = useState<Record<string, MMUser>>({})
  const [teamMembers, setTeamMembers] = useState<MMUser[]>([])
  const [newChannelOpen, setNewChannelOpen] = useState(false)
  const [newChannelDisplay, setNewChannelDisplay] = useState('')
  const [newChannelSlug, setNewChannelSlug] = useState('')
  const [channelBusy, setChannelBusy] = useState(false)
  const [channelFormError, setChannelFormError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/mattermost/teams')
      .then(r => {
        if (r.status === 401) {
          router.replace('/login')
          return null
        }
        return r.ok ? r.json() : Promise.reject()
      })
      .then(data => {
        if (cancelled || !data) return
        setTeams(data.teams ?? [])
      })
      .catch(() => router.replace('/login'))
    return () => {
      cancelled = true
    }
  }, [router])

  useEffect(() => {
    if (teams.length === 0) return
    const fromUrl = searchParams.get('team') || ''
    const valid = teams.find(t => t.id === fromUrl)
    const next = valid?.id ?? teams[0].id
    setActiveTeamId(next)
    if (typeof window !== 'undefined') sessionStorage.setItem(TEAM_KEY, next)
    if (!valid) {
      router.replace(`/home?team=${encodeURIComponent(next)}`)
    }
  }, [teams, searchParams, router])

  const loadChannels = useCallback(() => {
    if (!activeTeamId) return
    fetch(`/api/mattermost/channels?team_id=${encodeURIComponent(activeTeamId)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        const next = (data?.channels ?? []) as Channel[]
        setChannels(next)
        setChannel(prev => {
          if (prev && next.some(c => c.id === prev.id)) return prev
          return next.find(c => c.name === 'all-aaelink') ?? next[0] ?? null
        })
      })
      .catch(() => {})
  }, [activeTeamId])

  useEffect(() => {
    loadChannels()
  }, [loadChannels])

  async function createChannel() {
    setChannelFormError('')
    const display_name = newChannelDisplay.trim()
    if (!display_name || !activeTeamId) {
      setChannelFormError('Enter a channel name.')
      return
    }
    setChannelBusy(true)
    const res = await fetch('/api/mattermost/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        team_id: activeTeamId,
        display_name,
        name: newChannelSlug.trim() || undefined
      })
    })
    setChannelBusy(false)
    if (!res.ok) {
      setChannelFormError('Could not create channel. Check permissions and URL name.')
      return
    }
    const data = await res.json()
    const created = data?.channel as Channel | undefined
    setNewChannelOpen(false)
    setNewChannelDisplay('')
    setNewChannelSlug('')
    loadChannels()
    if (created?.id) {
      setChannel(created)
    }
  }

  useEffect(() => {
    fetch('/api/mattermost/me')
      .then(r => (r.ok ? r.json() : null))
      .then(data => setMe(data?.user ?? null))
      .catch(() => { })
  }, [])

  useEffect(() => {
    if (!activeTeamId) return
    fetch(`/api/mattermost/team-users?team_id=${encodeURIComponent(activeTeamId)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => setTeamMembers(data?.users ?? []))
      .catch(() => setTeamMembers([]))
  }, [activeTeamId])

  const resolveUsers = useCallback(async (list: ChatPost[]) => {
    const ids = [...new Set(list.map(p => p.user_id).filter(Boolean))]
    if (ids.length === 0) return
    const res = await fetch('/api/mattermost/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    })
    if (!res.ok) return
    const data = await res.json()
    const users = (data?.users ?? []) as MMUser[]
    setUserMap(prev => {
      const next = { ...prev }
      for (const u of users) next[u.id] = u
      return next
    })
  }, [])

  useEffect(() => {
    if (posts.length === 0) return
    void resolveUsers(posts)
  }, [posts, resolveUsers])

  useEffect(() => {
    if (!channel) return
    fetch(`/api/mattermost/posts?channel_id=${encodeURIComponent(channel.id)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data?.order && data?.posts) {
          setPosts(data.order.map((id: string) => data.posts[id]).reverse())
        }
      })
      .catch(() => { })

    const onPost = (post: ChatPost) => {
      if (post.channel_id === channel.id) {
        setPosts(current => {
          const withoutDup = current.filter(p => p.id !== post.id && !(p.pending && p.user_id === 'me'))
          return [...withoutDup, post]
        })
      }
    }
    connectMattermost(onPost).then(() => setOnline(true))
    return () => disconnectMattermost(onPost)
  }, [channel])

  async function send() {
    const message = draft.trim()
    if (!message || !channel) return
    const pending: ChatPost = {
      id: crypto.randomUUID(),
      channel_id: channel.id,
      user_id: 'me',
      message,
      create_at: Date.now(),
      pending: true
    }
    setPosts(current => [...current, pending])
    setDraft('')
    const res = await fetch('/api/mattermost/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_id: channel.id, message })
    })
    if (res.ok) {
      const saved = (await res.json()) as ChatPost
      setPosts(current => [...current.filter(p => p.id !== pending.id), saved])
    } else {
      setPosts(current => current.filter(p => p.id !== pending.id))
    }
  }

  const activeTeam = useMemo(() => teams.find(t => t.id === activeTeamId), [teams, activeTeamId])
  const dmPreview = useMemo(() => {
    return teamMembers.filter(u => u.id !== me?.id).slice(0, 8)
  }, [teamMembers, me])

  const channelTitle = channel?.display_name || channel?.name || 'channel'

  return (
    <main className="app-shell">
      <aside className="workspace-rail" aria-label="Workspaces">
        {teams.map(t => (
          <Link
            key={t.id}
            href={`/home?team=${encodeURIComponent(t.id)}`}
            className={`workspace-icon${t.id === activeTeamId ? ' active' : ''}`}
            title={t.display_name}
            onClick={() => sessionStorage.setItem(TEAM_KEY, t.id)}
          >
            {(t.display_name || t.name).slice(0, 1).toUpperCase()}
          </Link>
        ))}
        <div className="rail-dot" />
        <Link className="workspace-icon small" href="/workspaces" title="All workspaces">
          +
        </Link>
      </aside>

      <aside className="channel-list">
        <header className="team-header">
          <strong>{activeTeam?.display_name || 'Workspace'}</strong>
          <Link href="/workspaces" className="team-header-link">
            Switch
          </Link>
        </header>

        <section className="channel-section">
          <div className="channel-section-head">
            <p>Channels</p>
            <button type="button" className="channel-add" onClick={() => setNewChannelOpen(true)}>
              Add channel
            </button>
          </div>
          {channels.map(item => (
            <button
              type="button"
              className={channel?.id === item.id ? 'channel active' : 'channel'}
              key={item.id}
              onClick={() => setChannel(item)}
            >
              <span>#</span>
              {item.display_name || item.name}
            </button>
          ))}
        </section>

        <section className="channel-section">
          <p>Modules</p>
          <Link className="channel" href="/tickets">
            <span aria-hidden="true">•</span>
            Tickets
          </Link>
          <Link className="channel" href="/documents">
            <span aria-hidden="true">•</span>
            Documents
          </Link>
        </section>

        <section className="channel-section">
          <p>People</p>
          {dmPreview.length === 0 ? (
            <p className="channel-empty">No members loaded yet.</p>
          ) : (
            dmPreview.map(u => (
              <div className="channel dm" key={u.id}>
                <span className="presence" aria-hidden="true" />
                {displayName(u)}
              </div>
            ))
          )}
        </section>
      </aside>

      <section className="chat-pane">
        <header className="chat-header">
          <div>
            <h1># {channelTitle}</h1>
            <p>{activeTeam ? `${activeTeam.display_name} · ` : ''}Live messages from Mattermost.</p>
          </div>
          <span className={`status-pill${online ? ' online' : ''}`}>{online ? 'Connected' : 'Connecting'}</span>
        </header>

        <div className="message-timeline">
          <div className="channel-hero">
            <h2>#{channelTitle}</h2>
            <p>Company-wide updates and collaboration. Messages sync in real time.</p>
          </div>

          {posts.length === 0 && (
            <article className="message">
              <div className="avatar">A</div>
              <div>
                <div className="message-meta">
                  <strong>AAELink</strong>
                  <span>now</span>
                </div>
                <p>No messages yet. Say hello below.</p>
              </div>
            </article>
          )}

          {posts.map(post => {
            const isSelf = Boolean(me?.id && post.user_id === me.id)
            const u = userMap[post.user_id]
            const label = post.user_id === 'me' || isSelf ? 'You' : u ? displayName(u) : post.user_id.slice(0, 8)
            const initial = (u?.username || label).slice(0, 1).toUpperCase()
            return (
              <article className="message" key={post.id}>
                <div className="avatar" aria-hidden="true">
                  {initial}
                </div>
                <div>
                  <div className="message-meta">
                    <strong>{label}</strong>
                    <span>{post.pending ? 'Sending' : new Date(post.create_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <p>{post.message}</p>
                  <div className="reaction-row">
                    <button type="button" className="thread-tease">
                      Reply in thread
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>

        <footer className="composer">
          <div className="toolbar" role="toolbar" aria-label="Formatting">
            <button type="button">B</button>
            <button type="button">I</button>
            <button type="button">Link</button>
            <button type="button">Code</button>
            <button type="button">Attach</button>
          </div>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder={`Message #${channelTitle}`}
          />
          <div className="composer-actions">
            <span>Shift+Enter for a new line.</span>
            <button type="button" className="send-button" onClick={() => void send()}>
              Send
            </button>
          </div>
        </footer>
      </section>

      <aside className="thread-pane" aria-label="Thread">
        <header>
          <strong>Thread</strong>
          <span># {channelTitle}</span>
        </header>
        <div className="thread-body">
          <p>Select a message to open its thread.</p>
          <div className="thread-card">
            <strong>Focused discussion</strong>
            <p>Threads keep side conversations organized without cluttering the main channel.</p>
          </div>
        </div>
      </aside>

      {newChannelOpen ? (
        <div className="modal-overlay" role="presentation" onClick={() => !channelBusy && setNewChannelOpen(false)}>
          <div
            className="modal-panel slack-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-channel-title"
            onClick={e => e.stopPropagation()}
          >
            <h2 id="new-channel-title" style={{ marginTop: 0 }}>
              Create channel
            </h2>
            <label className="field-label">
              Display name
              <input
                className="slack-input"
                value={newChannelDisplay}
                onChange={e => setNewChannelDisplay(e.target.value)}
                placeholder="e.g. Engineering"
              />
            </label>
            <label className="field-label" style={{ marginTop: 12 }}>
              URL name (optional)
              <input
                className="slack-input"
                value={newChannelSlug}
                onChange={e => setNewChannelSlug(e.target.value)}
                placeholder="Auto from display name if empty"
              />
            </label>
            {channelFormError ? <p className="form-error">{channelFormError}</p> : null}
            <div className="modal-actions">
              <button type="button" className="ghost-button" onClick={() => !channelBusy && setNewChannelOpen(false)}>
                Cancel
              </button>
              <button type="button" className="slack-button" disabled={channelBusy} onClick={() => void createChannel()}>
                {channelBusy ? 'Creating' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <main className="app-shell-loading">
          <p>Loading workspace</p>
        </main>
      }
    >
      <HomeChat />
    </Suspense>
  )
}
