'use client'

import { useCallback, useEffect, useState } from 'react'
import { Globe, Lightbulb, Plus, X, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { useConfirm } from '@/components/a11y'
import { toast } from '@/lib/ui/toast'

/* ─────────────────────────────────────────────────────────────────────
   DomainClaimingPanel — Domain Verification (Slack domain claiming)
   Wires /api/admin/org/[orgId]/domains:
     GET    → { domains, total }    (list claims)
     POST   { domain }              (claim → TXT record)
     PATCH  { domain }              (verify pending claim via DNS TXT)
     DELETE { domain }              (remove claim)
   Self-resolves an orgId from /api/admin/org (first org).
   ───────────────────────────────────────────────────────────────────── */

interface OrgDomain {
  domain: string
  verification_token: string
  verified: boolean
  verified_at: number
  created_at: number
}
interface Org { id: string; name: string; domain: string }

const VERIFY_RECORD = (token: string): string => `aaelink-verify=${token}`

export default function DomainClaimingPanel({ onClose }: { onClose: () => void }) {
  const { confirm, confirmDialog } = useConfirm()
  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')
  const [domains, setDomains] = useState<OrgDomain[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [newDomain, setNewDomain] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const loadDomains = useCallback(async (id: string) => {
    setLoading(true); setError(null)
    try {
      const res = await apiFetch(`/api/admin/org/${id}/domains`)
      if (!res.ok) { setError('load_failed'); return }
      const data = await res.json() as { domains?: OrgDomain[] }
      setDomains(data.domains || [])
    } catch { setError('load_failed') } finally { setLoading(false) }
  }, [])

  const init = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await apiFetch('/api/admin/org')
      if (!res.ok) { setError('no_org'); setLoading(false); return }
      const data = await res.json() as { organizations?: Org[] }
      const org = (data.organizations || [])[0]
      if (!org) { setError('no_org'); setLoading(false); return }
      setOrgId(org.id); setOrgName(org.name)
      await loadDomains(org.id)
    } catch { setError('no_org'); setLoading(false) }
  }, [loadDomains])

  useEffect(() => { void init() }, [init])

  const addDomain = async () => {
    if (!newDomain.trim() || !orgId) return
    setBusy('add')
    try {
      const res = await apiFetch(`/api/admin/org/${orgId}/domains`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: newDomain.trim() }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})) as { error?: string }; toast.error(e.error || 'claim_failed'); return }
      toast.success('Domain claimed. Publish the TXT record, then verify.')
      setShowAdd(false); setNewDomain('')
      await loadDomains(orgId)
    } catch { toast.error('claim_failed') } finally { setBusy(null) }
  }

  const verify = async (domain: string) => {
    if (!orgId) return
    setBusy(domain)
    try {
      const res = await apiFetch(`/api/admin/org/${orgId}/domains`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})) as { error?: string }; toast.error(e.error || 'verify_failed'); return }
      const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string }
      if (!data.ok) { toast.error(data.error || 'verify_failed'); return }
      toast.success(`${domain} verified.`)
      await loadDomains(orgId)
    } catch { toast.error('verify_failed') } finally { setBusy(null) }
  }

  const remove = async (domain: string) => {
    if (!orgId) return
    if (!(await confirm({ title: 'Remove domain', message: `Remove ${domain}? This revokes the claim.`, danger: true, confirmLabel: 'Remove' }))) return
    setBusy(domain)
    try {
      const res = await apiFetch(`/api/admin/org/${orgId}/domains`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})) as { error?: string }; toast.error(e.error || 'remove_failed'); return }
      toast.success(`${domain} removed.`)
      await loadDomains(orgId)
    } catch { toast.error('remove_failed') } finally { setBusy(null) }
  }

  const verifiedCount = domains.filter(d => d.verified).length
  const pendingCount = domains.length - verifiedCount

  return (
    <>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--mm-main-bg)', color: 'var(--mm-text)' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #2bac76, #059669)', display: 'grid', placeItems: 'center', color: '#fff' }}><Globe size={18} /></div>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Domain Claiming</h2>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>{orgName ? `Verify domains for ${orgName}` : 'Verify ownership of email domains'}</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowAdd(true)} disabled={!orgId} style={{ background: 'linear-gradient(135deg, #2bac76, #059669)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: orgId ? 'pointer' : 'not-allowed', opacity: orgId ? 1 : 0.5, display: 'flex', alignItems: 'center', gap: 4 }}><Plus size={13} /> Claim Domain</button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}><X size={18} /></button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {[
            { label: 'Verified Domains', value: verifiedCount, color: '#2bac76' },
            { label: 'Total Claims', value: domains.length, color: '#4361EE' },
            { label: 'Pending Verification', value: pendingCount, color: '#e8912d' },
          ].map(s => (
            <div key={s.label} style={{ padding: 12, borderRadius: 10, border: '1px solid var(--mm-border)', textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 11, opacity: 0.6 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        <div style={{ padding: 12, borderRadius: 8, background: '#4361EE08', border: '1px solid #4361EE20', fontSize: 12, lineHeight: 1.6, marginBottom: 16 }}>
          <Lightbulb size={14} style={{ color: '#4361EE', flexShrink: 0 }} /> Claim a domain, publish the <strong>TXT record</strong> at the domain root, then verify. A verified domain may belong to only one organization.
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--mm-muted)' }}><Loader2 size={20} className="spin" /> Loading domains…</div>
        ) : error === 'no_org' ? (
          <div style={{ textAlign: 'center', padding: 24, opacity: 0.6, fontSize: 13 }}>No organization found. Create an organization first.</div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: 24, fontSize: 13, color: '#e01e5a' }}>Failed to load domains. <button onClick={() => orgId && void loadDomains(orgId)} style={{ background: 'none', border: 'none', color: '#4361EE', cursor: 'pointer', textDecoration: 'underline' }}>Retry</button></div>
        ) : domains.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, opacity: 0.5, fontSize: 13 }}>No domains claimed. Claim a domain to verify ownership.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {domains.map(d => {
              const open = expanded === d.domain
              const c = d.verified ? { bg: '#2bac7620', text: '#2bac76', icon: '✓', label: 'verified' } : { bg: '#e8912d20', text: '#e8912d', icon: '⏳', label: 'pending' }
              return (
                <div key={d.domain} style={{ borderRadius: 12, border: '1px solid var(--mm-border)', overflow: 'hidden' }}>
                  <div onClick={() => setExpanded(open ? null : d.domain)} className="aae-hoverable" aria-expanded={open}
                    style={{ padding: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 40, height: 40, borderRadius: 10, background: c.bg, display: 'grid', placeItems: 'center', fontSize: 16, color: c.text, fontWeight: 700 }}>{c.icon}</div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{d.domain}</div>
                        <div style={{ fontSize: 12, opacity: 0.6 }}>{d.verified ? 'Verified' : 'Awaiting DNS TXT verification'}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, background: c.bg, color: c.text, fontWeight: 600, textTransform: 'capitalize' }}>{c.label}</span>
                      <span className={`aae-chevron-toggle${open ? ' aae-chevron-toggle--open' : ''}`} style={{ fontSize: 14, display: 'inline-block' }}>▾</span>
                    </div>
                  </div>
                  {open && (
                    <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--mm-border)', fontSize: 13 }}>
                      {!d.verified && d.verification_token && (
                        <div style={{ padding: 12, borderRadius: 8, background: 'var(--mm-hover-bg)', margin: '12px 0', fontSize: 12 }}>
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>Add this TXT record at <code>{d.domain}</code>:</div>
                          <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{VERIFY_RECORD(d.verification_token)}</code>
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                        {!d.verified && <button onClick={(e) => { e.stopPropagation(); void verify(d.domain) }} disabled={busy === d.domain} style={{ background: '#4361EE', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: busy === d.domain ? 'wait' : 'pointer', fontWeight: 600, opacity: busy === d.domain ? 0.6 : 1 }}>{busy === d.domain ? 'Verifying…' : 'Verify Now'}</button>}
                        <button onClick={(e) => { e.stopPropagation(); void remove(d.domain) }} disabled={busy === d.domain} style={{ background: '#e01e5a20', color: '#e01e5a', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: busy === d.domain ? 'wait' : 'pointer', fontWeight: 600, opacity: busy === d.domain ? 0.6 : 1 }}>Remove Domain</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000, display: 'grid', placeItems: 'center', animation: 'slack-modal-in 200ms var(--slack-ease-bounce) forwards' }} onClick={() => setShowAdd(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--mm-main-bg)', borderRadius: 16, padding: 24, width: 460, boxShadow: 'var(--slack-shadow-modal)' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 800 }}>Claim Domain</h3>
            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>Domain name</label>
            <input value={newDomain} onChange={e => setNewDomain(e.target.value)} placeholder="example.com" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 14, marginBottom: 16, outline: 'none', boxSizing: 'border-box' }} />
            <p style={{ fontSize: 12, opacity: 0.6, marginBottom: 16 }}>After claiming, you will receive a TXT record to publish at the domain root, then verify here.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowAdd(false); setNewDomain('') }} style={{ background: 'var(--mm-hover-bg)', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', color: 'var(--mm-text)', fontSize: 13 }}>Cancel</button>
              <button onClick={() => void addDomain()} disabled={!newDomain.trim() || busy === 'add'} style={{ background: '#2bac76', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: newDomain.trim() && busy !== 'add' ? 1 : 0.5 }}>{busy === 'add' ? 'Claiming…' : 'Claim Domain'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
    {confirmDialog}
    </>
  )
}
