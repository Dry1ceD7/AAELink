'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Loader2, Camera, Save } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { toast } from '@/lib/ui/toast'

/* ─────────────────────────────────────────────────────────────────────
   ProfileEditModal — edit the signed-in user's own profile.

   Wires the EXISTING backend:
   - GET  /api/users/profile           → seed the form (own profile)
   - POST /api/files/upload (multipart) → optional avatar upload
   - PUT  /api/users/profile            → persist the edits

   Server field mapping (see app/api/users/profile/route.ts):
   - display_name → users.nickname (preferred display-name source)
   - title / phone / pronouns / timezone → user_preferences profile.* keys
   - avatar_url → users.avatar_url (direct column)
   - bio → sent as a profile field; persisted only if the profile route's
     allowedFields includes it (currently it does not — see note below).

   Mount this from UserProfilePanel for the viewer's OWN profile only. The
   panel already exposes `isOwnProfile`; add an "Edit profile" affordance that
   sets local open state and renders:
       <ProfileEditModal open={editOpen} onClose={() => setEditOpen(false)}
                         onSaved={() => void load()} />
   ───────────────────────────────────────────────────────────────────── */

interface ProfileFormState {
  display_name: string
  title: string
  phone: string
  pronouns: string
  timezone: string
  bio: string
  avatar_url: string
}

const EMPTY_FORM: ProfileFormState = {
  display_name: '',
  title: '',
  phone: '',
  pronouns: '',
  timezone: '',
  bio: '',
  avatar_url: '',
}

/** Shape returned by GET /api/users/profile (the bits this modal seeds from). */
interface ProfileGetResponse {
  profile?: {
    display_name?: string
    title?: string
    phone?: string
    pronouns?: string
    timezone?: string
    avatar_url?: string
    fields?: Record<string, string>
  }
}

/** Tolerate both the documented `{ attachment: { download_url } }` shape and a
 *  flat `{ download_url | url }` shape, so the avatar URL resolves either way. */
function resolveUploadUrl(data: unknown): string {
  const d = data as {
    url?: string
    download_url?: string
    attachment?: { download_url?: string; url?: string }
  } | null
  return (
    d?.attachment?.download_url ||
    d?.attachment?.url ||
    d?.download_url ||
    d?.url ||
    ''
  )
}

interface Props {
  /** When false the modal is fully unmounted (no overlay rendered). */
  open: boolean
  /** Close request (Esc, X, backdrop, or after a successful save). */
  onClose: () => void
  /** Fired after a successful PUT so the parent can refetch the profile. */
  onSaved?: () => void
}

export function ProfileEditModal({ open, onClose, onSaved }: Props) {
  const [form, setForm] = useState<ProfileFormState>(EMPTY_FORM)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  /* ── Seed the form from the user's own profile when opened ─────────── */
  const load = useCallback(async () => {
    setLoading(true)
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    try {
      const res = await apiFetch('/api/users/profile', { signal: abortRef.current.signal })
      if (!res.ok) {
        toast.error('Could not load your profile')
        return
      }
      const body = (await res.json()) as ProfileGetResponse
      const p = body.profile || {}
      const fields = p.fields || {}
      setForm({
        display_name: p.display_name || '',
        title: p.title || fields.title || '',
        phone: p.phone || fields.phone || '',
        pronouns: p.pronouns || fields.pronouns || '',
        timezone: p.timezone && p.timezone !== 'UTC' ? p.timezone : (fields.timezone || ''),
        bio: fields.about || fields.bio || '',
        avatar_url: p.avatar_url || '',
      })
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      toast.error('Could not load your profile')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void load()
    return () => abortRef.current?.abort()
  }, [open, load])

  // Esc closes — only while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const setField = useCallback(<K extends keyof ProfileFormState>(key: K, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }, [])

  /* ── Optional avatar upload via the existing /api/files/upload ─────── */
  const handleAvatarUpload = useCallback(async (file: File | null) => {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { toast.error('Image must be under 5MB'); return }
    setAvatarUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('purpose', 'avatar')
      const upRes = await apiFetch('/api/files/upload', { method: 'POST', body: fd })
      if (!upRes.ok) { toast.error('Avatar upload failed'); return }
      const url = resolveUploadUrl(await upRes.json())
      if (!url) { toast.error('Upload returned no URL'); return }
      setField('avatar_url', url)
      toast.success('Avatar ready — save to apply')
    } catch {
      toast.error('Avatar upload failed')
    } finally {
      setAvatarUploading(false)
    }
  }, [setField])

  /* ── Persist via PUT /api/users/profile (CSRF added by apiFetch) ───── */
  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const res = await apiFetch('/api/users/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: form.display_name,
          title: form.title,
          phone: form.phone,
          pronouns: form.pronouns,
          timezone: form.timezone,
          // bio is sent for forward-compat; the profile route only persists
          // fields in its allowedFields list today.
          bio: form.bio,
          ...(form.avatar_url ? { avatar_url: form.avatar_url } : {}),
        }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(err.error ? `Save failed: ${err.error}` : 'Could not save profile')
        return
      }
      toast.success('Profile updated')
      onSaved?.()
      onClose()
    } catch {
      toast.error('Could not save profile')
    } finally {
      setSaving(false)
    }
  }, [form, onClose, onSaved])

  const initial = (form.display_name || 'U').charAt(0).toUpperCase()
  const busy = saving || avatarUploading

  if (!open) return null

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
        animation: 'slack-fade-in 200ms ease forwards',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit your profile"
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--mm-main-bg)', color: 'var(--mm-text)',
          borderRadius: 16, boxShadow: 'var(--slack-shadow-modal)',
          width: 480, maxWidth: '92vw', maxHeight: '88vh', overflowY: 'auto',
          animation: 'slack-modal-in 300ms var(--slack-ease-bounce) forwards',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--mm-border)',
        }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Edit profile</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)', padding: 4 }}
          >
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 60, opacity: 0.6 }}>
            <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13 }}>Loading your profile…</span>
          </div>
        ) : (
          <div style={{ padding: 20 }}>
            {/* Avatar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
              <div style={{
                position: 'relative', width: 72, height: 72, borderRadius: 16, overflow: 'hidden',
                background: 'linear-gradient(135deg, #2B35AF, #4CC9F0)',
                display: 'grid', placeItems: 'center', flexShrink: 0,
              }}>
                {form.avatar_url
                  ? <img src={form.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: 28, fontWeight: 700, color: '#fff' }}>{initial}</span>}
                {avatarUploading && (
                  <div style={{
                    position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
                    background: 'rgba(0,0,0,0.45)',
                  }}>
                    <Loader2 size={20} style={{ color: '#fff', animation: 'spin 1s linear infinite' }} />
                  </div>
                )}
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={avatarUploading}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: 'none', border: '1px solid var(--mm-border)', borderRadius: 8,
                    padding: '6px 12px', fontSize: 13, cursor: avatarUploading ? 'default' : 'pointer',
                    color: 'var(--mm-text)', opacity: avatarUploading ? 0.6 : 1,
                  }}
                >
                  <Camera size={14} /> Upload photo
                </button>
                <div style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}>PNG or JPG, under 5MB.</div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={e => { void handleAvatarUpload(e.target.files?.[0] || null); e.target.value = '' }}
                />
              </div>
            </div>

            {/* Fields */}
            <Field label="Display name">
              <input
                value={form.display_name}
                onChange={e => setField('display_name', e.target.value)}
                placeholder="How your name appears"
                style={inputStyle}
              />
            </Field>
            <Field label="Title">
              <input
                value={form.title}
                onChange={e => setField('title', e.target.value)}
                placeholder="e.g. Senior Engineer"
                style={inputStyle}
              />
            </Field>
            <Field label="Phone">
              <input
                value={form.phone}
                onChange={e => setField('phone', e.target.value)}
                placeholder="e.g. +66 2 000 0000"
                style={inputStyle}
              />
            </Field>
            <Field label="Pronouns">
              <input
                value={form.pronouns}
                onChange={e => setField('pronouns', e.target.value)}
                placeholder="e.g. she/her, they/them"
                style={inputStyle}
              />
            </Field>
            <Field label="Timezone">
              <input
                value={form.timezone}
                onChange={e => setField('timezone', e.target.value)}
                placeholder="e.g. Asia/Bangkok"
                style={inputStyle}
              />
            </Field>
            <Field label="Bio">
              <textarea
                value={form.bio}
                onChange={e => setField('bio', e.target.value)}
                placeholder="A short description about you"
                rows={3}
                style={{ ...inputStyle, resize: 'vertical', minHeight: 64 }}
              />
            </Field>
          </div>
        )}

        {/* Footer */}
        {!loading && (
          <div style={{
            display: 'flex', justifyContent: 'flex-end', gap: 8,
            padding: '14px 20px', borderTop: '1px solid var(--mm-border)',
          }}>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              style={{
                background: 'none', border: '1px solid var(--mm-border)', borderRadius: 8,
                padding: '8px 16px', fontSize: 13, cursor: busy ? 'default' : 'pointer',
                color: 'var(--mm-text)', opacity: busy ? 0.6 : 1,
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={busy}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: '#4361EE', border: 'none', borderRadius: 8,
                padding: '8px 16px', fontSize: 13, fontWeight: 600, color: '#fff',
                cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1,
              }}
            >
              {saving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  border: '1px solid var(--mm-border)', borderRadius: 8,
  padding: '8px 12px', fontSize: 13,
  background: 'var(--mm-main-bg)', color: 'var(--mm-text)', outline: 'none',
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span style={{ display: 'block', fontSize: 12, fontWeight: 600, opacity: 0.7, marginBottom: 6 }}>{label}</span>
      {children}
    </label>
  )
}

export default ProfileEditModal
