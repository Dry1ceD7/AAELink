import type { ChatPost } from '@/lib/realtime'
import type { AppUser } from '@/app/components/chat/ChatMessage'
import type { ReactionSummary } from '@/lib/reactions'

export interface Channel {
  id: string
  name: string
  display_name: string
  team_id: string
  type?: string
  unread_count?: number
  dm_peer_display?: string
  purpose?: string
  header?: string
}

export interface Team {
  id: string
  name: string
  display_name: string
}

/** Props shared across the decomposed layout sections */
export interface HomeSharedState {
  /* ── Workspace/Team ───────────────────────────────────── */
  teams: Team[]
  activeTeamId: string
  activeTeam: Team | undefined
  me: AppUser | null

  /* ── Channels ─────────────────────────────────────────── */
  channels: Channel[]
  channel: Channel | null
  setChannel: (ch: Channel | null) => void
  channelsOpen: boolean
  setChannelsOpen: (v: boolean | ((p: boolean) => boolean)) => void
  loadChannels: () => void

  /* ── Posts / Chat ─────────────────────────────────────── */
  posts: ChatPost[]
  setPosts: React.Dispatch<React.SetStateAction<ChatPost[]>>
  postsLoading: boolean
  olderAvailable: boolean
  olderLoading: boolean
  streamUp: boolean

  /* ── User map ─────────────────────────────────────────── */
  userMap: Record<string, AppUser>
  teamMembers: AppUser[]

  /* ── Sidebar extras ───────────────────────────────────── */
  starredIds: Set<string>
  draftIds: Set<string>
  handleToggleStar: (channelId: string) => void

  /* ── Module routing ───────────────────────────────────── */
  activeModule: string | null

  /* ── Presence ─────────────────────────────────────────── */
  getStatus: (userId: string) => string

  /* ── DM helpers ───────────────────────────────────────── */
  openDm: (peerId: string) => void
  startChat: (peerIds: string[]) => Promise<void>

  /* ── Actions ──────────────────────────────────────────── */
  handleSend: (message: string) => Promise<void>
  handleEditMessage: (post: ChatPost) => void
  handleSaveEdit: (postId: string, newText: string) => Promise<void>
  handleDeleteMessage: (post: ChatPost) => void
  handlePinMessage: (post: ChatPost) => Promise<void>
  handleForwardMessage: (post: ChatPost) => void
  onReactionsUpdated: (messageId: string, reactions: ReactionSummary[]) => void
  loadOlder: () => Promise<void>
  scrollToBottom: () => void
  resolveUsers: (list: ChatPost[]) => Promise<void>
}
