/**
 * Message types for AAELink.
 *
 * Defines message entities, rich-text blocks, reactions,
 * file attachments, and thread summaries.
 * Type-only — no runtime code.
 *
 * @module types/messages
 */

/** Block element types within a message block. */
export type BlockElementType =
  | 'text'
  | 'emoji'
  | 'user_mention'
  | 'channel_mention'
  | 'link'
  | 'code'

/** Individual element within a message block. */
export interface BlockElement {
  /** Element type. */
  type: BlockElementType
  /** Text or value content. */
  text?: string
  /** Referenced user/channel ID for mentions. */
  ref_id?: string
  /** URL for link elements. */
  url?: string
  /** Styling flags. */
  style?: {
    /** Bold text. */
    bold?: boolean
    /** Italic text. */
    italic?: boolean
    /** Strikethrough text. */
    strike?: boolean
  }
}

/** Rich text block types. */
export type MessageBlockType =
  | 'rich_text'
  | 'section'
  | 'divider'
  | 'image'
  | 'context'
  | 'actions'
  | 'header'

/** Rich text block within a message. */
export interface MessageBlock {
  /** Block type identifier. */
  type: MessageBlockType
  /** Child elements within this block. */
  elements: BlockElement[]
}

/** Reaction on a message. */
export interface Reaction {
  /** Emoji shortcode (e.g. "thumbsup"). */
  emoji: string
  /** User IDs who added this reaction. */
  user_ids: string[]
  /** Total reaction count. */
  count: number
}

/** File attachment metadata. */
export interface FileAttachment {
  /** Unique file identifier. */
  id: string
  /** Original filename. */
  name: string
  /** MIME type (e.g. "image/png"). */
  mimetype: string
  /** File size in bytes. */
  size: number
  /** Download URL. */
  url: string
  /** Thumbnail URL (null if not applicable). */
  thumbnail_url: string | null
}

/** Thread metadata summary. */
export interface ThreadSummary {
  /** Number of replies in the thread. */
  reply_count: number
  /** User IDs of participants who replied. */
  reply_users: string[]
  /** Timestamp of the latest reply. */
  latest_reply_ts: string
}

/** Message entity representing a single chat message. */
export interface Message {
  /** Unique message identifier. */
  id: string
  /** Channel this message was posted in. */
  channel_id: string
  /** User who sent the message. */
  user_id: string
  /** Plain-text content. */
  text: string
  /** Rich-text blocks (empty array if plain text only). */
  blocks: MessageBlock[]
  /** Thread root message ID (null if top-level). */
  thread_root_id: string | null
  /** ISO-8601 timestamp of last edit (null if never edited). */
  edited_at: string | null
  /** ISO-8601 timestamp of deletion (null if not deleted). */
  deleted_at: string | null
  /** Reactions on this message. */
  reactions: Reaction[]
  /** Attached files. */
  files: FileAttachment[]
  /** Message timestamp (Slack-style string timestamp). */
  timestamp: string
}
