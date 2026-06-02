'use client'

import { Menu } from 'lucide-react'
import { NotificationsBell } from '@/components/notifications/NotificationsBell'
import { TicketsPanel } from '@/components/tickets/TicketsPanel'
import { DocumentsPanel } from '@/components/documents/DocumentsPanel'
import { ApprovalsPanel } from '@/components/workspace/ApprovalsPanel'
import { KnowledgeBasePanel } from '@/components/workspace/KnowledgeBasePanel'
import { CalendarPanel } from '@/components/workspace/CalendarPanel'
import { IntegrationsPanel } from '@/components/workspace/IntegrationsPanel'
import { SsoSettingsPanel } from '@/components/shared/SsoSettingsPanel'
import { ThreadsListPanel } from '@/components/shared/ThreadsListPanel'
import { SavedItemsPanel } from '@/components/shared/SavedItemsPanel'
import { MarketplacePanel } from '@/components/workspace/MarketplacePanel'
import CatchUpView from '@/components/shared/CatchUpView'
import PeopleDirectoryPanel from '@/components/user/PeopleDirectoryPanel'
import HuddlePanel from '@/components/workspace/HuddlePanel'
import CallHistoryPanel from '@/components/workspace/CallHistoryPanel'
import CanvasEditor from '@/components/shared/CanvasEditor'
import DataRetentionSettings from '@/components/admin/DataRetentionSettings'
import InformationBarriers from '@/components/admin/InformationBarriers'
import DLPSettingsPanel from '@/components/admin/DLPSettingsPanel'
import WorkflowBuilder from '@/components/workspace/WorkflowBuilder'
import SlackConnectPanel from '@/components/channels/SlackConnectPanel'
import EKMPanel from '@/components/admin/EKMPanel'
import LegalHoldPanel from '@/components/admin/LegalHoldPanel'
import DomainClaimingPanel from '@/components/admin/DomainClaimingPanel'
import EMMPanel from '@/components/admin/EMMPanel'
import AuditLogPanel from '@/components/admin/AuditLogPanel'
import SessionManagementPanel from '@/components/admin/SessionManagementPanel'
import UserGroupsPanel from '@/components/user/UserGroupsPanel'
import ChannelAnalyticsPanel from '@/components/channels/ChannelAnalyticsPanel'
import DraftsPanel from '@/components/user/DraftsPanel'
import WorkspaceExportPanel from '@/components/admin/WorkspaceExportPanel'
import NotificationSchedulePanel from '@/components/notifications/NotificationSchedulePanel'
import AppDirectoryPanel from '@/components/workspace/AppDirectoryPanel'
import AccessibilityPanel from '@/components/user/AccessibilityPanel'
import FileBrowserPanel from '@/components/media/FileBrowserPanel'
import StatusPagePanel from '@/components/workspace/StatusPagePanel'
import SlackListPanel from '@/components/workspace/SlackListPanel'
import CustomEmojiPanel from '@/components/shared/CustomEmojiPanel'
import { ActivityPanel } from '@/components/shared/ActivityPanel'
import HRPanel from '@/components/workspace/HRPanel'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import type { AppUser } from '@/components/chat/ChatMessage'
import type { Channel } from './types'

/* ── Shared header wrapper for module panels ───────────────────────── */
function ModuleHeader({
  title, subtitle, channelsOpen, setChannelsOpen, me
}: {
  title: string
  subtitle: string
  channelsOpen: boolean
  setChannelsOpen: (v: boolean | ((p: boolean) => boolean)) => void
  me: AppUser | null
}) {
  return (
    <header className="chat-header">
      <div className="chat-header-nav">
        <button type="button" className="app-shell-menu-btn"
          aria-expanded={channelsOpen} aria-controls="app-shell-channel-list"
          aria-label={channelsOpen ? 'Close channels list' : 'Open channels list'}
          onClick={() => setChannelsOpen(o => !o)}>
          <Menu size={20} strokeWidth={2} aria-hidden />
        </button>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="chat-header-nav">
        <NotificationsBell enabled={Boolean(me)} />
      </div>
    </header>
  )
}

/* ── Module registry ───────────────────────────────────────────────── */
interface ModuleRendererProps {
  activeModule: string
  activeTeamId: string
  channelTitle: string
  channelsOpen: boolean
  setChannelsOpen: (v: boolean | ((p: boolean) => boolean)) => void
  me: AppUser | null
  channels: Channel[]
  openDm: (peerId: string) => void
  navigateHome: () => void
  navigateToChannel: (channelId: string, msgId?: string) => void
  navigateToThread: (channelId: string, rootId: string) => void
}

/**
 * Renders the active module panel inside the main pane.
 * Returns `null` if the activeModule doesn't match any known module (caller should render chat).
 */
export function ModuleRenderer({
  activeModule, activeTeamId, channelTitle,
  channelsOpen, setChannelsOpen, me,
  channels, openDm,
  navigateHome, navigateToChannel, navigateToThread
}: ModuleRendererProps) {
  const isAdmin = me && isPlatformAdmin(me.platform_role)

  /* ── Standard module panel (header + component) ─────── */
  const std = (title: string, subtitle: string, content: React.ReactNode, opts?: { style?: React.CSSProperties }) => (
    <section className="chat-pane" style={{ background: 'var(--mm-main-bg)', ...opts?.style }}>
      <ModuleHeader title={title} subtitle={subtitle}
        channelsOpen={channelsOpen} setChannelsOpen={setChannelsOpen} me={me} />
      <div style={{ flex: 1, position: 'relative', overflowY: 'auto' }}>
        {content}
      </div>
    </section>
  )

  /* ── Bare module panel (no header — component provides its own) ── */
  const bare = (content: React.ReactNode, opts?: { style?: React.CSSProperties }) => (
    <section className="chat-pane" style={{ background: 'var(--mm-main-bg)', ...opts?.style }}>
      {content}
    </section>
  )

  switch (activeModule) {
    /* ── Enterprise modules ─────────────────────────────── */
    case 'tickets':
      return std('Tickets', 'Manage and track support requests',
        <TicketsPanel workspaceId={activeTeamId} onBlockingOverlayChange={() => {}} />)
    case 'documents':
      return std('Documents', 'Shared files and policies',
        <DocumentsPanel workspaceId={activeTeamId} />)
    case 'approvals':
      return std('Approvals', 'Manage pending workflows and requests',
        <ApprovalsPanel workspaceId={activeTeamId} />)
    case 'knowledge':
      return std('Knowledge Base', 'Company wiki and documentation',
        <KnowledgeBasePanel workspaceId={activeTeamId} />)
    case 'calendar':
      return std('HR & Calendar', 'Schedule events, manage leaves, and track attendance',
        <CalendarPanel workspaceId={activeTeamId} />)
    case 'marketplace':
      return std('Plugin Marketplace', 'Browse, install, and publish workspace plugins',
        <MarketplacePanel workspaceId={activeTeamId} />)
    case 'groups':
      return bare(<UserGroupsPanel onClose={navigateHome} />)
    case 'emoji':
      return bare(<CustomEmojiPanel onClose={navigateHome} />)

    /* ── Collaboration modules ─────────────────────────── */
    case 'threads':
      return (
        <section className="chat-pane" style={{ background: 'var(--mm-main-bg)' }}>
          <ModuleHeader title="Threads" subtitle="Keep track of conversations"
            channelsOpen={channelsOpen} setChannelsOpen={setChannelsOpen} me={me} />
          <ThreadsListPanel workspaceId={activeTeamId} onOpenThread={(chId, rootId) => navigateToThread(chId, rootId)} />
        </section>
      )
    case 'saved':
    case 'later':
      return (
        <section className="chat-pane" style={{ background: 'var(--mm-main-bg)' }}>
          <ModuleHeader title="Saved items" subtitle="Your saved messages and files"
            channelsOpen={channelsOpen} setChannelsOpen={setChannelsOpen} me={me} />
          <SavedItemsPanel onOpenMessage={(chId, msgId) => navigateToChannel(chId, msgId)} />
        </section>
      )
    case 'activity':
      return bare(
        <ActivityPanel workspaceId={activeTeamId} onClose={navigateHome}
          onNavigateToChannel={(chId, msgId) => navigateToChannel(chId, msgId)} />)
    case 'catchup':
      return bare(
        <CatchUpView onClose={navigateHome}
          onNavigateToChannel={(chId) => navigateToChannel(chId)} />)
    case 'huddles':
    case 'huddle':
      return bare(
        <HuddlePanel channelName={channelTitle} onClose={navigateHome} />,
        activeModule === 'huddle' ? { style: { background: '#1a1a2e' } } : undefined)
    case 'calls':
    case 'call_history':
      return bare(<CallHistoryPanel onClose={navigateHome} />)
    case 'canvas':
      return bare(<CanvasEditor channelName={channelTitle} onClose={navigateHome} />)
    case 'people':
      return bare(<PeopleDirectoryPanel onClose={navigateHome} onStartDM={(uid) => openDm(uid)} />)
    case 'lists':
      return bare(<SlackListPanel channelName={channelTitle} onClose={navigateHome} />)
    case 'workflows':
      return bare(<WorkflowBuilder onClose={navigateHome} />)
    case 'connect':
      return bare(<SlackConnectPanel onClose={navigateHome} />)
    case 'drafts':
      return bare(<DraftsPanel onClose={navigateHome} />)
    case 'apps':
      return bare(<AppDirectoryPanel onClose={navigateHome} />)
    case 'accessibility':
      return bare(<AccessibilityPanel onClose={navigateHome} />)
    case 'files':
      return bare(<FileBrowserPanel onClose={navigateHome} />)
    case 'status':
      return bare(<StatusPagePanel onClose={navigateHome} />)
    case 'hr':
      return bare(<HRPanel workspaceId={activeTeamId} onClose={navigateHome} />)
    case 'notif_schedule':
      return bare(<NotificationSchedulePanel onClose={navigateHome} />)

    /* ── Admin-only modules ─────────────────────────────── */
    case 'integrations':
      if (!isAdmin) return null
      return std('Integrations', 'Connect external tools, webhooks, and apps',
        <IntegrationsPanel workspaceId={activeTeamId} />)
    case 'sso':
      if (!isAdmin) return null
      return std('SSO Settings', 'Configure Single Sign-On and Identity Providers',
        <SsoSettingsPanel />)
    case 'retention':
      if (!isAdmin) return null
      return bare(<DataRetentionSettings onClose={navigateHome} />)
    case 'barriers':
      if (!isAdmin) return null
      return bare(<InformationBarriers onClose={navigateHome} />)
    case 'dlp':
      if (!isAdmin) return null
      return bare(<DLPSettingsPanel onClose={navigateHome} />)
    case 'ekm':
      if (!isAdmin) return null
      return bare(<EKMPanel onClose={navigateHome} />)
    case 'legal_hold':
      if (!isAdmin) return null
      return bare(<LegalHoldPanel onClose={navigateHome} />)
    case 'domains':
      if (!isAdmin) return null
      return bare(<DomainClaimingPanel onClose={navigateHome} />)
    case 'emm':
      if (!isAdmin) return null
      return bare(<EMMPanel onClose={navigateHome} />)
    case 'audit':
      if (!isAdmin) return null
      return bare(<AuditLogPanel onClose={navigateHome} />)
    case 'sessions':
      if (!isAdmin) return null
      return bare(<SessionManagementPanel onClose={navigateHome} />)
    case 'analytics':
      if (!isAdmin) return null
      return bare(<ChannelAnalyticsPanel onClose={navigateHome} />)
    case 'export':
      if (!isAdmin) return null
      return bare(<WorkspaceExportPanel onClose={navigateHome} />)

    default:
      return null
  }
}
