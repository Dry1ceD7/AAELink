'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { UserPlus, Settings, Paintbrush, Keyboard, SmilePlus, Plus, ShieldAlert, LogOut } from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'
import { isPlatformAdmin } from '@/lib/platformRole'

interface WorkspaceDropdownProps {
  open: boolean
  onClose: () => void
  workspaceId: string
  workspaceName: string
  workspaceSlug: string
  me: { id: string; platform_role?: string } | null
  onInvite: (url: string, busy: boolean) => void
  onOpenPreferences: () => void
  onOpenSidebarCustomizer: () => void
  onOpenShortcuts: () => void
  onOpenEmojiPanel: () => void
}

export function WorkspaceDropdown({
  open, onClose, workspaceId, workspaceName, workspaceSlug, me,
  onInvite, onOpenPreferences, onOpenSidebarCustomizer, onOpenShortcuts, onOpenEmojiPanel
}: WorkspaceDropdownProps) {
  const router = useRouter()

  if (!open) return null

  return (
    <>
      <div className="ws-menu-backdrop" onClick={onClose} />
      <div className="ws-dropdown" role="menu" aria-label="Workspace options">
        <div className="ws-dropdown-header">
          <div className="ws-dropdown-avatar">{(workspaceName || 'W').slice(0, 1).toUpperCase()}</div>
          <div>
            <strong className="ws-dropdown-name">{workspaceName || 'Workspace'}</strong>
            <span className="ws-dropdown-url">{workspaceSlug || ''}.aaelink.app</span>
          </div>
        </div>
        <div className="ws-dropdown-divider" />
        <button type="button" className="ws-dropdown-item" onClick={async () => {
          onClose()
          onInvite('', true)
          try {
            const res = await apiFetch('/api/workspaces/invite', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ workspace_id: workspaceId })
            })
            if (res.ok) {
              const data = await res.json() as { invite_url: string }
              onInvite(`${window.location.origin}${data.invite_url}`, false)
            } else {
              onInvite('', false)
            }
          } catch {
            onInvite('', false)
          }
        }}>
          <UserPlus size={16} /> Invite people to {workspaceName || 'workspace'}
        </button>
        <button type="button" className="ws-dropdown-item" onClick={() => { onClose(); onOpenPreferences() }}>
          <Settings size={16} /> Preferences
        </button>
        <button type="button" className="ws-dropdown-item" onClick={() => { onClose(); onOpenSidebarCustomizer() }}>
          <Paintbrush size={16} /> Customize sidebar
        </button>
        <button type="button" className="ws-dropdown-item" onClick={() => { onClose(); onOpenShortcuts() }}>
          <Keyboard size={16} /> Keyboard shortcuts
        </button>
        <button type="button" className="ws-dropdown-item" onClick={() => { onClose(); onOpenEmojiPanel() }}>
          <SmilePlus size={16} /> Custom emoji
        </button>
        <div className="ws-dropdown-divider" />
        <Link href="/workspaces" className="ws-dropdown-item" onClick={onClose}>
          <Plus size={16} /> Create or join a workspace
        </Link>
        {me && isPlatformAdmin(me.platform_role) ? (
          <Link href="/admin" className="ws-dropdown-item" onClick={onClose}>
            <ShieldAlert size={16} /> Administration
          </Link>
        ) : null}
        <div className="ws-dropdown-divider" />
        <button type="button" className="ws-dropdown-item ws-dropdown-item--danger"
          onClick={async () => { onClose(); await apiFetch('/api/auth/logout', { method: 'POST' }); router.replace('/login') }}>
          <LogOut size={16} /> Sign out of {workspaceName || 'workspace'}
        </button>
      </div>
    </>
  )
}
