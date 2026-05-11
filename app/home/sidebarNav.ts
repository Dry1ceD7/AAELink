import { Home, MessageSquare, PenLine, FolderOpen, Users, AppWindow, StickyNote, Headphones, Workflow, ListChecks, Sparkles, Link2, Package, Accessibility, Activity, ClipboardList, AlignLeft, FileText, CheckSquare, Book, Calendar, SmilePlus, Puzzle, ShieldAlert, FolderArchive, Shield, LockKeyhole, Key, Scale, Globe, Smartphone, Monitor, BarChart3, PackageOpen, Bell, Bookmark, MoreHorizontal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface NavItem {
  module: string
  label: string
  icon: LucideIcon
  /** For items that match multiple module keys (e.g. huddles/huddle) */
  altModules?: string[]
}

/** Slack-style top navigation (always visible above channels) */
export const TOP_NAV_ITEMS: NavItem[] = [
  { module: 'home', label: 'Home', icon: Home },
  { module: 'threads', label: 'Threads', icon: MessageSquare },
  { module: 'activity', label: 'Activity', icon: Bell },
  { module: 'later', label: 'Later', icon: Bookmark },
]

/** "More" submenu items */
export const MORE_NAV_ITEMS: NavItem[] = [
  { module: 'drafts', label: 'Drafts & sent', icon: PenLine },
  { module: 'files', label: 'Files', icon: FolderOpen },
  { module: 'people', label: 'People & user groups', icon: Users },
  { module: 'apps', label: 'Apps', icon: AppWindow },
  { module: 'canvas', label: 'Canvases', icon: StickyNote },
  { module: 'huddles', label: 'Huddles', icon: Headphones, altModules: ['huddle'] },
  { module: 'workflows', label: 'Automations', icon: Workflow },
  { module: 'lists', label: 'Lists', icon: ListChecks },
  { module: 'ai', label: 'AAELink AI', icon: Sparkles },
  { module: 'connect', label: 'AAELink Connect', icon: Link2 },
  { module: 'marketplace', label: 'Marketplace', icon: Package },
  { module: 'accessibility', label: 'Accessibility', icon: Accessibility },
  { module: 'status', label: 'System Status', icon: Activity },
  { module: 'hr', label: 'HR & Attendance', icon: ClipboardList },
]

/** All "More" module keys for parent button highlight */
export const MORE_MODULE_KEYS = MORE_NAV_ITEMS.flatMap(i => [i.module, ...(i.altModules || [])])


/** Enterprise section items (shown in workspace/settings menu, not sidebar) */
export const ENTERPRISE_NAV_ITEMS: NavItem[] = [
  { module: 'tickets', label: 'Tickets', icon: AlignLeft },
  { module: 'documents', label: 'Documents', icon: FileText },
  { module: 'approvals', label: 'Approvals', icon: CheckSquare },
  { module: 'knowledge', label: 'Knowledge Base', icon: Book },
  { module: 'calendar', label: 'HR & Calendar', icon: Calendar },
  { module: 'groups', label: 'User Groups', icon: Users },
  { module: 'emoji', label: 'Custom Emoji', icon: SmilePlus },
]

/** All "Enterprise" module keys for section highlight */
export const ENTERPRISE_MODULE_KEYS = ENTERPRISE_NAV_ITEMS.flatMap(i => [i.module, ...(i.altModules || [])])

/** Administration section items (admin-only, shown in workspace/settings menu) */
export const ADMIN_NAV_ITEMS: NavItem[] = [
  { module: 'integrations', label: 'Integrations', icon: Puzzle },
  { module: 'sso', label: 'SSO Settings', icon: ShieldAlert },
  { module: 'retention', label: 'Data Retention', icon: FolderArchive },
  { module: 'barriers', label: 'Info Barriers', icon: Shield },
  { module: 'dlp', label: 'DLP', icon: LockKeyhole },
  { module: 'ekm', label: 'Key Management', icon: Key },
  { module: 'legal_hold', label: 'Legal Holds', icon: Scale },
  { module: 'domains', label: 'Domain Claiming', icon: Globe },
  { module: 'emm', label: 'Device Management', icon: Smartphone },
  { module: 'audit', label: 'Audit Log', icon: ClipboardList },
  { module: 'sessions', label: 'Sessions', icon: Monitor },
  { module: 'analytics', label: 'Analytics', icon: BarChart3 },
  { module: 'export', label: 'Export', icon: PackageOpen },
]

/** Icon for the "More" expander itself */
export const MORE_ICON = MoreHorizontal
