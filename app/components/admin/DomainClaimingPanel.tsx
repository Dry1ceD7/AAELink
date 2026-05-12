'use client'

import { useCallback, useEffect, useState } from 'react'
import { Globe, Lightbulb, Plus, X, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'
import { useConfirm } from '@/app/components/a11y'

/* ─────────────────────────────────────────────────────────────────────
   DomainClaimingPanel — Domain Verification & Auto-Capture
   • Verify ownership of email domains
   • Auto-capture users signing up with verified domains
   • Manage verified/pending domains
   ───────────────────────────────────────────────────────────────────── */

interface Domain {
  id: string
  domain: string
  status: string
  verification_method: string
  auto_capture: boolean
  users_count: number
  added_at: string
  verified_at?: string
}

const statusConfig: Record<string, { bg: string; text: string; icon: string }> = {
  verified: { bg: '#2bac7620', text: '#2bac76', icon: '✓' },
  pending: { bg: '#e8912d20', text: '#e8912d', icon: '⏳' },
  failed: { bg: '#e01e5a20', text: '#e01e5a', icon: '✗' },
}

export default function DomainClaimingPanel({ onClose }: { onClose: () => void }) {
  const { confirm, confirmDialog } = useConfirm()
  const [domains, setDomains] = useState<Domain[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newDomain, setNewDomain] = useState('')
  const [verifyMethod, setVerifyMethod] = useState<'dns_txt' | 'dns_cname' | 'email'>('dns_txt')
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/admin/domains')
      if (res.ok) {
        const data = await res.json() as { domains?: Domain[] }
        setDomains(data.domains || [])
      }
    } catch {
      // API may not exist yet — start with empty
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const toggleAutoCapture = async (id: string, current: boolean) => {
    await apiFetch('/api/admin/domains', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, auto_capture: !current }),
    })
    setDomains(prev => prev.map(d => d.id === id ? { ...d, auto_capture: !current } : d))
  }

  const addDomain = async () => {
    if (!newDomain) return
    await apiFetch('/api/admin/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: newDomain, verification_method: verifyMethod }),
    })
    setShowAdd(false)
    setNewDomain('')
    void load()
  }

  const removeDomain = async (id: string) => {
    if (!(await confirm({ title: 'Remove domain', message: 'Remove this domain? Users will no longer be auto-captured.', danger: true, confirmLabel: 'Remove' }))) return
    await apiFetch('/api/admin/domains', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    void load()
  }

  const dnsRecord = newDomain ? `aaelink-verify=${btoa(newDomain).slice(0, 16)}` : ''

  return (
    <>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--mm-main-bg)', color: 'var(--mm-text)' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #2bac76, #059669)', display: 'grid', placeItems: 'center', color: '#fff' }}><Globe size={18} /></div>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Domain Claiming</h2>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>Verify domains & auto-capture signups</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowAdd(true)} style={{ background: 'linear-gradient(135deg, #2bac76, #059669)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}><Plus size={13} /> Add Domain</button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}><X size={18} /></button>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {[
            { label: 'Verified Domains', value: domains.filter(d => d.status === 'verified').length, color: '#2bac76' },
            { label: 'Auto-Captured Users', value: domains.reduce((s, d) => s + (d.users_count || 0), 0), color: '#4361EE' },
            { label: 'Pending Verification', value: domains.filter(d => d.status === 'pending').length, color: '#e8912d' },
          ].map(s => (
            <div key={s.label} style={{ padding: 12, borderRadius: 10, border: '1px solid var(--mm-border)', textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 11, opacity: 0.6 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        <div style={{ padding: 12, borderRadius: 8, background: '#4361EE08', border: '1px solid #4361EE20', fontSize: 12, lineHeight: 1.6, marginBottom: 16 }}>
          <Lightbulb size={14} style={{ color: '#4361EE', flexShrink: 0 }} /> <strong>Auto-capture</strong> automatically adds users who sign up with a verified domain email to your workspace. They will be added to all default channels.
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--mm-muted)' }}><Loader2 size={20} className="spin" /> Loading domains…</div>
        ) : domains.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, opacity: 0.5, fontSize: 13 }}>No domains configured. Add a domain to enable auto-capture.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {domains.map(domain => {
              const st = statusConfig[domain.status] || statusConfig.pending
              const expanded = expandedDomain === domain.id
              return (
                <div key={domain.id} style={{ borderRadius: 12, border: '1px solid var(--mm-border)', overflow: 'hidden' }}>
                  <div onClick={() => setExpandedDomain(expanded ? null : domain.id)} style={{ padding: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--mm-hover-bg)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 40, height: 40, borderRadius: 10, background: st.bg, display: 'grid', placeItems: 'center', fontSize: 16, color: st.text, fontWeight: 700 }}>{st.icon}</div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{domain.domain}</div>
                        <div style={{ fontSize: 12, opacity: 0.6 }}>
                          {domain.status === 'verified' ? `${domain.users_count || 0} users · Verified ${domain.verified_at || ''}` : 'Awaiting verification'}
                          {domain.auto_capture && ' · Auto-capture ON'}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, background: st.bg, color: st.text, fontWeight: 600, textTransform: 'capitalize' }}>{domain.status}</span>
                      <span style={{ fontSize: 14, transition: 'transform 200ms', transform: expanded ? 'rotate(180deg)' : 'rotate(0)' }}>▾</span>
                    </div>
                  </div>
                  {expanded && (
                    <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--mm-border)', fontSize: 13 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
                        <div><span style={{ opacity: 0.5 }}>Verification:</span> {(domain.verification_method || '').replace('_', ' ').toUpperCase()}</div>
                        <div><span style={{ opacity: 0.5 }}>Added:</span> {domain.added_at}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, padding: 10, borderRadius: 8, background: 'var(--mm-hover-bg)' }}>
                        <div><div style={{ fontWeight: 600 }}>Auto-capture signups</div><div style={{ fontSize: 11, opacity: 0.6 }}>Auto-add users with @{domain.domain} emails</div></div>
                        <div onClick={() => void toggleAutoCapture(domain.id, domain.auto_capture)} style={{ width: 44, height: 24, borderRadius: 12, background: domain.auto_capture ? '#2bac76' : 'var(--mm-border)', cursor: 'pointer', position: 'relative', transition: 'background 200ms' }}>
                          <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: domain.auto_capture ? 23 : 3, transition: 'left 200ms' }} />
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                        {domain.status === 'pending' && <button style={{ background: '#4361EE', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Verify Now</button>}
                        <button onClick={(e) => { e.stopPropagation(); void removeDomain(domain.id) }} style={{ background: '#e01e5a20', color: '#e01e5a', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Remove Domain</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Add Domain Modal */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000, display: 'grid', placeItems: 'center', animation: 'slack-modal-in 200ms var(--slack-ease-bounce) forwards' }} onClick={() => setShowAdd(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--mm-main-bg)', borderRadius: 16, padding: 24, width: 460, boxShadow: 'var(--slack-shadow-modal)' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 800 }}>Add Domain</h3>
            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>Domain name</label>
            <input value={newDomain} onChange={e => setNewDomain(e.target.value)} placeholder="example.com" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 14, marginBottom: 16, outline: 'none', boxSizing: 'border-box' }} />
            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>Verification method</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {[
                { id: 'dns_txt' as const, label: 'DNS TXT Record', desc: 'Add a TXT record to your DNS' },
                { id: 'dns_cname' as const, label: 'DNS CNAME Record', desc: 'Add a CNAME record to your DNS' },
                { id: 'email' as const, label: 'Email Verification', desc: 'We\'ll send a code to admin@domain' },
              ].map(m => (
                <button key={m.id} onClick={() => setVerifyMethod(m.id)} style={{
                  padding: 12, borderRadius: 8, border: verifyMethod === m.id ? '2px solid #2bac76' : '1px solid var(--mm-border)',
                  background: verifyMethod === m.id ? '#2bac7608' : 'var(--mm-main-bg)', cursor: 'pointer', textAlign: 'left',
                }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{m.label}</div>
                  <div style={{ fontSize: 11, opacity: 0.6 }}>{m.desc}</div>
                </button>
              ))}
            </div>
            {newDomain && verifyMethod.startsWith('dns') && (
              <div style={{ padding: 12, borderRadius: 8, background: 'var(--mm-hover-bg)', marginBottom: 16, fontSize: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Add this {verifyMethod === 'dns_txt' ? 'TXT' : 'CNAME'} record:</div>
                <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{dnsRecord}</code>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowAdd(false); setNewDomain('') }} style={{ background: 'var(--mm-hover-bg)', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', color: 'var(--mm-text)', fontSize: 13 }}>Cancel</button>
              <button onClick={() => void addDomain()} style={{ background: '#2bac76', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: newDomain ? 1 : 0.5 }}>Add Domain</button>
            </div>
          </div>
        </div>
      )}
    </div>
    {confirmDialog}
    </>
  )
}
