'use client'

import { useCallback, useEffect, useState } from 'react'
import { Building2, Globe, Layers, Plus, X, Loader2, RefreshCw } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { useConfirm } from '@/components/a11y'
import { toast } from '@/lib/ui/toast'

/* ─────────────────────────────────────────────────────────────────────
   OrgConsolePanel — Enterprise Grid read-first console.
   Loads:  /api/admin/org                       → { organizations }
           /api/admin/org/[orgId]/workspaces    → { workspaces }
           /api/admin/org/[orgId]/domains       → { domains, total }
   Safe mutations on the domains route (confirm + toast):
           POST   { domain }  claim
           PATCH  { domain }  verify
   ───────────────────────────────────────────────────────────────────── */

interface Org { id: string; name: string; domain: string; plan: string }
interface Workspace { id: string; name: string; display_name: string }
interface OrgDomain { domain: string; verified: boolean; verification_token: string }

const PLAN_LABEL: Record<string, string> = {
  free: 'Free', pro: 'Pro', business_plus: 'Business+', enterprise_grid: 'Enterprise Grid',
}

export default function OrgConsolePanel({ onClose }: { onClose: () => void }) {
  const { confirm, confirmDialog } = useConfirm()
  const [orgs, setOrgs] = useState<Org[]>([])
  const [orgId, setOrgId] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [domains, setDomains] = useState<OrgDomain[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [newDomain, setNewDomain] = useState('')

  const loadDetail = useCallback(async (id: string) => {
    setError(null)
    try {
      const [wsRes, dRes] = await Promise.all([
        apiFetch(`/api/admin/org/${id}/workspaces`),
        apiFetch(`/api/admin/org/${id}/domains`),
      ])
      if (wsRes.ok) setWorkspaces(((await wsRes.json()) as { workspaces?: Workspace[] }).workspaces || [])
      else setWorkspaces([])
      if (dRes.ok) setDomains(((await dRes.json()) as { domains?: OrgDomain[] }).domains || [])
      else setDomains([])
    } catch { setError('detail_failed') }
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await apiFetch('/api/admin/org')
      if (!res.ok) { setError('load_failed'); setLoading(false); return }
      const list = ((await res.json()) as { organizations?: Org[] }).organizations || []
      setOrgs(list)
      if (list[0]) { setOrgId(list[0].id); await loadDetail(list[0].id) }
    } catch { setError('load_failed') } finally { setLoading(false) }
  }, [loadDetail])

  useEffect(() => { void load() }, [load])

  const selectOrg = async (id: string) => { setOrgId(id); setWorkspaces([]); setDomains([]); await loadDetail(id) }

  const claimDomain = async () => {
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
      await loadDetail(orgId)
    } catch { toast.error('claim_failed') } finally { setBusy(null) }
  }

  const verifyDomain = async (domain: string) => {
    if (!orgId) return
    if (!(await confirm({ title: 'Verify domain', message: `Check DNS TXT record for ${domain} now?`, confirmLabel: 'Verify' }))) return
    setBusy(domain)
    try {
      const res = await apiFetch(`/api/admin/org/${orgId}/domains`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      })
      const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) { toast.error(data.error || 'verify_failed'); return }
      toast.success(`${domain} verified.`)
      await loadDetail(orgId)
    } catch { toast.error('verify_failed') } finally { setBusy(null) }
  }

  const activeOrg = orgs.find(o => o.id === orgId) || null

  return (
    <>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--mm-main-bg)', color: 'var(--mm-text)' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #4361EE, #3a0ca3)', display: 'grid', placeItems: 'center', color: '#fff' }}><Building2 size={18} /></div>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Organization Console</h2>
            <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>Enterprise Grid — workspaces & domains</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => void load()} title="Refresh" style={{ background: 'var(--mm-hover-bg)', border: 'none', borderRadius: 8, padding: 8, cursor: 'pointer', color: 'var(--mm-text)', display: 'grid', placeItems: 'center' }}><RefreshCw size={15} /></button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}><X size={18} /></button>
        </div>
      </div>

      {loading ? (
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--mm-muted)' }}><div><Loader2 size={20} className="spin" /> Loading organizations…</div></div>
      ) : error === 'load_failed' ? (
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', fontSize: 13, color: '#e01e5a' }}><div>Failed to load. <button onClick={() => void load()} style={{ background: 'none', border: 'none', color: '#4361EE', cursor: 'pointer', textDecoration: 'underline' }}>Retry</button></div></div>
      ) : orgs.length === 0 ? (
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', opacity: 0.6, fontSize: 13 }}>No organizations found. Create one to begin.</div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {orgs.length > 1 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              {orgs.map(o => (
                <button key={o.id} onClick={() => void selectOrg(o.id)} style={{
                  padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  border: o.id === orgId ? '2px solid #4361EE' : '1px solid var(--mm-border)',
                  background: o.id === orgId ? '#4361EE12' : 'var(--mm-main-bg)', color: 'var(--mm-text)',
                }}>{o.name}</button>
              ))}
            </div>
          )}

          {activeOrg && (
            <div style={{ padding: 16, borderRadius: 12, border: '1px solid var(--mm-border)', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{activeOrg.name}</div>
                <div style={{ fontSize: 12, opacity: 0.6 }}>{activeOrg.domain}</div>
              </div>
              <span style={{ fontSize: 11, padding: '4px 12px', borderRadius: 8, background: '#4361EE12', color: '#4361EE', fontWeight: 700 }}>{PLAN_LABEL[activeOrg.plan] || activeOrg.plan}</span>
            </div>
          )}

          <section style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 13, fontWeight: 700 }}><Layers size={15} style={{ color: '#4361EE' }} /> Workspaces <span style={{ opacity: 0.5, fontWeight: 500 }}>({workspaces.length})</span></div>
            {workspaces.length === 0 ? (
              <div style={{ padding: 16, borderRadius: 10, border: '1px dashed var(--mm-border)', opacity: 0.6, fontSize: 13, textAlign: 'center' }}>No workspaces bound to this organization.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
                {workspaces.map(w => (
                  <div key={w.id} style={{ padding: 14, borderRadius: 10, border: '1px solid var(--mm-border)' }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{w.display_name || w.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.6 }}>{w.name}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700 }}><Globe size={15} style={{ color: '#2bac76' }} /> Domains <span style={{ opacity: 0.5, fontWeight: 500 }}>({domains.length})</span></div>
              <button onClick={() => setShowAdd(true)} disabled={!orgId} style={{ background: 'linear-gradient(135deg, #2bac76, #059669)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: orgId ? 'pointer' : 'not-allowed', opacity: orgId ? 1 : 0.5, display: 'flex', alignItems: 'center', gap: 4 }}><Plus size={12} /> Claim</button>
            </div>
            {domains.length === 0 ? (
              <div style={{ padding: 16, borderRadius: 10, border: '1px dashed var(--mm-border)', opacity: 0.6, fontSize: 13, textAlign: 'center' }}>No domains claimed for this organization.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {domains.map(d => (
                  <div key={d.domain} style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid var(--mm-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 14, color: d.verified ? '#2bac76' : '#e8912d' }}>{d.verified ? '✓' : '⏳'}</span>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{d.domain}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, background: d.verified ? '#2bac7620' : '#e8912d20', color: d.verified ? '#2bac76' : '#e8912d', fontWeight: 600 }}>{d.verified ? 'Verified' : 'Pending'}</span>
                      {!d.verified && <button onClick={() => void verifyDomain(d.domain)} disabled={busy === d.domain} style={{ background: '#4361EE', color: '#fff', border: 'none', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: busy === d.domain ? 'wait' : 'pointer', opacity: busy === d.domain ? 0.6 : 1 }}>{busy === d.domain ? 'Verifying…' : 'Verify'}</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000, display: 'grid', placeItems: 'center', animation: 'slack-modal-in 200ms var(--slack-ease-bounce) forwards' }} onClick={() => setShowAdd(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--mm-main-bg)', borderRadius: 16, padding: 24, width: 440, boxShadow: 'var(--slack-shadow-modal)' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 800 }}>Claim Domain</h3>
            <input value={newDomain} onChange={e => setNewDomain(e.target.value)} placeholder="example.com" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 14, marginBottom: 16, outline: 'none', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowAdd(false); setNewDomain('') }} style={{ background: 'var(--mm-hover-bg)', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', color: 'var(--mm-text)', fontSize: 13 }}>Cancel</button>
              <button onClick={() => void claimDomain()} disabled={!newDomain.trim() || busy === 'add'} style={{ background: '#2bac76', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: newDomain.trim() && busy !== 'add' ? 1 : 0.5 }}>{busy === 'add' ? 'Claiming…' : 'Claim'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
    {confirmDialog}
    </>
  )
}
