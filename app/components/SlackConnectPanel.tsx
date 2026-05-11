'use client'

import { useCallback, useEffect, useState } from 'react'
import { Link2, Plus, X, Mail, Clock, AlertTriangle, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'

/* ─────────────────────────────────────────────────────────────────────
   SlackConnectPanel — Cross-org shared channel management
   • Invite external orgs to shared channels
   • Manage pending/active connections
   • Security & compliance controls
   ───────────────────────────────────────────────────────────────────── */

interface SharedLink {
  id: string
  channel_id: string
  channel_name: string
  remote_org: string
  remote_domain: string
  status: string
  member_count?: number
  external_members?: number
  created_at: string
}

export default function SlackConnectPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'channels' | 'orgs' | 'invites'>('channels')
  const [links, setLinks] = useState<SharedLink[]>([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteChannel, setInviteChannel] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/channels/shared')
      if (res.ok) {
        const data = await res.json() as { links?: SharedLink[] }
        setLinks(data.links || [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const sendInvite = async () => {
    if (!inviteEmail || !inviteChannel) return
    await apiFetch('/api/channels/shared', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'invite',
        email: inviteEmail,
        channel_name: inviteChannel,
      }),
    })
    setShowInvite(false)
    setInviteEmail('')
    setInviteChannel('')
    void load()
  }

  const acceptInvite = async (linkId: string) => {
    await apiFetch('/api/channels/shared', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'accept', link_id: linkId }),
    })
    void load()
  }

  const declineInvite = async (linkId: string) => {
    await apiFetch('/api/channels/shared', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'decline', link_id: linkId }),
    })
    void load()
  }

  const activeLinks = links.filter(l => l.status === 'active' || l.status === 'accepted')
  const pendingLinks = links.filter(l => l.status === 'pending')

  // Group by org
  const orgMap = new Map<string, { name: string; domain: string; channels: number; status: string }>()
  for (const l of links) {
    const key = l.remote_org || l.remote_domain
    const existing = orgMap.get(key)
    if (existing) {
      existing.channels++
    } else {
      orgMap.set(key, { name: l.remote_org || key, domain: l.remote_domain || '', channels: 1, status: l.status })
    }
  }
  const orgs = Array.from(orgMap.entries()).map(([id, v]) => ({ id, ...v }))

  const filteredChannels = [...activeLinks, ...pendingLinks].filter(c =>
    (c.channel_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.remote_org || '').toLowerCase().includes(search.toLowerCase())
  )

  const statusColors: Record<string, string> = {
    active: '#2bac76', accepted: '#2bac76', pending: '#e8912d', declined: '#e01e5a', revoked: '#e01e5a',
  }

  const tabs = [
    { key: 'channels' as const, label: 'Shared Channels', count: filteredChannels.length },
    { key: 'orgs' as const, label: 'Organizations', count: orgs.length },
    { key: 'invites' as const, label: 'Pending Invites', count: pendingLinks.length },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--mm-main-bg)', color: 'var(--mm-text)' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'linear-gradient(135deg, #4361EE, #4CC9F0)',
              display: 'grid', placeItems: 'center', color: '#fff',
            }}><Link2 size={18} /></div>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>AAELink Connect</h2>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>Work with external organizations</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowInvite(true)} style={{
              background: 'linear-gradient(135deg, #4361EE, #2B35AF)', color: '#fff',
              border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13,
              fontWeight: 600, cursor: 'pointer',
            }}>+ Invite Organization</button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4 }}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding: '6px 14px', borderRadius: 8, border: 'none', fontSize: 13,
              fontWeight: tab === t.key ? 700 : 500, cursor: 'pointer',
              background: tab === t.key ? '#4361EE' : 'var(--mm-hover-bg)',
              color: tab === t.key ? '#fff' : 'var(--mm-text)',
              transition: 'all 150ms ease',
            }}>
              {t.label} <span style={{ opacity: 0.7, fontSize: 11 }}>({t.count})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--mm-muted)' }}><Loader2 size={20} className="spin" /> Loading connections…</div>
        ) : (
          <>
            {tab === 'channels' && (
              <>
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search shared channels…"
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 8,
                    border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)',
                    color: 'var(--mm-text)', fontSize: 14, marginBottom: 16, outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
                {filteredChannels.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 40, opacity: 0.5, fontSize: 13 }}>No shared channels yet. Invite an organization to get started.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {filteredChannels.map(ch => (
                      <div key={ch.id} style={{
                        padding: 14, borderRadius: 10, border: '1px solid var(--mm-border)',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        transition: 'border-color 150ms ease',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = '#4361EE')}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--mm-border)')}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 16 }}>#</span>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>{ch.channel_name}</div>
                            <div style={{ fontSize: 12, opacity: 0.6 }}>
                              {ch.remote_org} · {ch.member_count ?? 0} members ({ch.external_members ?? 0} external)
                            </div>
                          </div>
                        </div>
                        <span style={{
                          fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
                          background: `${statusColors[ch.status] || '#616061'}20`,
                          color: statusColors[ch.status] || '#616061',
                          textTransform: 'capitalize',
                        }}>{ch.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {tab === 'orgs' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {orgs.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 40, opacity: 0.5, fontSize: 13 }}>No connected organizations yet.</div>
                ) : orgs.map(org => (
                  <div key={org.id} style={{
                    padding: 16, borderRadius: 12, border: '1px solid var(--mm-border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: 10,
                        background: 'linear-gradient(135deg, #12086F, #4361EE)',
                        display: 'grid', placeItems: 'center', color: '#fff',
                        fontSize: 18, fontWeight: 700,
                      }}>{org.name[0]}</div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{org.name}</div>
                        <div style={{ fontSize: 12, opacity: 0.6 }}>
                          {org.domain} · {org.channels} shared channel{org.channels !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                    <span style={{
                      fontSize: 11, padding: '3px 10px', borderRadius: 10, fontWeight: 600,
                      background: `${statusColors[org.status] || '#616061'}20`,
                      color: statusColors[org.status] || '#616061',
                      textTransform: 'capitalize',
                    }}>{org.status}</span>
                  </div>
                ))}
              </div>
            )}

            {tab === 'invites' && (
              <div>
                {pendingLinks.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 60, opacity: 0.5 }}>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}><Mail size={36} /></div>
                    <p>No pending invites</p>
                  </div>
                ) : (
                  pendingLinks.map(link => (
                    <div key={link.id} style={{
                      padding: 16, borderRadius: 12, border: '1px solid var(--mm-border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      marginBottom: 8,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 44, height: 44, borderRadius: 10,
                          background: '#e8912d20', display: 'grid', placeItems: 'center',
                        }}><Clock size={20} style={{ color: '#e8912d' }} /></div>
                        <div>
                          <div style={{ fontWeight: 700 }}>{link.remote_org || link.remote_domain}</div>
                          <div style={{ fontSize: 12, opacity: 0.6 }}>{link.channel_name} · Invitation pending</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => void acceptInvite(link.id)} style={{
                          background: '#2bac76', color: '#fff', border: 'none', borderRadius: 8,
                          padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 600,
                        }}>Accept</button>
                        <button onClick={() => void declineInvite(link.id)} style={{
                          background: 'var(--mm-hover-bg)', color: 'var(--mm-text)', border: 'none',
                          borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer',
                        }}>Decline</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Invite modal */}
      {showInvite && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000,
          display: 'grid', placeItems: 'center',
          animation: 'slack-modal-in 200ms var(--slack-ease-bounce) forwards',
        }} onClick={() => setShowInvite(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--mm-main-bg)', borderRadius: 16, padding: 24,
            width: 420, boxShadow: 'var(--slack-shadow-modal)',
          }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 800 }}>Invite an Organization</h3>
            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>Contact email</label>
            <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
              placeholder="admin@partner.com"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 8,
                border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)',
                color: 'var(--mm-text)', fontSize: 14, marginBottom: 16, outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>Channel to share</label>
            <input value={inviteChannel} onChange={e => setInviteChannel(e.target.value)}
              placeholder="#ext-partner-project"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 8,
                border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)',
                color: 'var(--mm-text)', fontSize: 14, marginBottom: 16, outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <div style={{
              padding: 12, borderRadius: 8, background: '#e8912d10',
              border: '1px solid #e8912d30', fontSize: 12, marginBottom: 16, lineHeight: 1.5,
            }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, color: '#e8912d' }} />
              <span>The external organization admin must accept the invite. Shared channels are subject to your workspace&apos;s data retention and DLP policies.</span>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowInvite(false)} style={{
                background: 'var(--mm-hover-bg)', border: 'none', borderRadius: 8,
                padding: '8px 16px', cursor: 'pointer', color: 'var(--mm-text)', fontSize: 13,
              }}>Cancel</button>
              <button onClick={() => void sendInvite()} style={{
                background: '#4361EE', color: '#fff', border: 'none', borderRadius: 8,
                padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                opacity: inviteEmail && inviteChannel ? 1 : 0.5,
              }}>Send Invite</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
