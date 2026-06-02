'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api/apiClient'
import { ShieldAlert, Save } from 'lucide-react'

interface SsoConfig {
  tenant_id: string
  client_id: string
  client_secret: string
  is_enabled: boolean
}

export function SsoSettingsPanel() {
  const [config, setConfig] = useState<SsoConfig | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/admin/sso')
      if (res.ok) {
        const data = await res.json()
        setConfig(data.config || { tenant_id: '', client_id: '', client_secret: '', is_enabled: false })
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'sso_load_failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadData() }, [loadData])

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    const form = e.currentTarget
    const tenant_id = (form.elements.namedItem('tenant_id') as HTMLInputElement).value
    const client_id = (form.elements.namedItem('client_id') as HTMLInputElement).value
    const client_secret = (form.elements.namedItem('client_secret') as HTMLInputElement).value
    const is_enabled = (form.elements.namedItem('is_enabled') as HTMLInputElement).checked

    try {
      const res = await apiFetch('/api/admin/sso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id, client_id, client_secret, is_enabled })
      })

      if (!res.ok) throw new Error('Failed to save SSO settings')
      setSuccess('Settings saved successfully.')
      await loadData()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'sso_save_failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 600 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <ShieldAlert size={24} color="var(--mm-link-color)" />
        <h2 style={{ margin: 0 }}>Single Sign-On (SSO)</h2>
      </div>

      <p style={{ color: 'var(--mm-muted)', marginBottom: 24 }}>
        Configure Microsoft Entra ID (formerly Azure AD) to allow your team to sign in securely.
      </p>

      {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}
      {success && <div style={{ color: 'green', marginBottom: 16, padding: '12px', background: 'rgba(0,255,0,0.1)', borderRadius: 8 }}>{success}</div>}

      {loading ? <p>Loading...</p> : (
        <form onSubmit={handleSave} className="admin-table" style={{ padding: 24, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label className="admin-label">Enable Microsoft Entra ID</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <input type="checkbox" name="is_enabled" defaultChecked={config?.is_enabled} style={{ width: 18, height: 18 }} />
              <span>Allow users to log in via Microsoft</span>
            </div>
          </div>

          <div style={{ marginTop: 8 }}>
            <label className="admin-label">Tenant ID</label>
            <input type="text" name="tenant_id" className="slack-input" defaultValue={config?.tenant_id} required placeholder="e.g. 8e3d... or yourdomain.onmicrosoft.com" />
            <div style={{ fontSize: 12, color: 'var(--mm-muted)', marginTop: 4 }}>Found in Microsoft Entra admin center &gt; Overview</div>
          </div>

          <div>
            <label className="admin-label">Client ID (Application ID)</label>
            <input type="text" name="client_id" className="slack-input" defaultValue={config?.client_id} required placeholder="e.g. 1a2b3c..." />
            <div style={{ fontSize: 12, color: 'var(--mm-muted)', marginTop: 4 }}>Found in App Registrations &gt; Overview</div>
          </div>

          <div>
            <label className="admin-label">Client Secret</label>
            <input type="password" name="client_secret" className="slack-input" defaultValue={config?.client_secret} required placeholder="Client secret value" />
            <div style={{ fontSize: 12, color: 'var(--mm-muted)', marginTop: 4 }}>Found in App Registrations &gt; Certificates & secrets</div>
          </div>

          <div style={{ background: 'var(--mm-sidebar-hover)', padding: 12, borderRadius: 8, marginTop: 12 }}>
            <h5 style={{ margin: '0 0 8px 0' }}>Redirect URI Configuration</h5>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--mm-muted)' }}>
              Add the following URL to your App Registration's Authentication platform settings (Web):
            </p>
            <code style={{ display: 'block', marginTop: 8, padding: 8, background: 'var(--mm-main-bg)', borderRadius: 8, fontSize: 12, wordBreak: 'break-all' }}>
              {typeof window !== 'undefined' ? `${window.location.origin}/api/auth/entra` : '/api/auth/entra'}
            </code>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="submit" className="slack-button" disabled={saving}>
              <Save size={16} style={{ marginRight: 6 }} /> {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
