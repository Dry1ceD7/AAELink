/**
 * AAELink — Incoming-webhook Slack-compatible payload parsing.
 *
 * The public receiver accepts the Slack/Mattermost incoming-webhook payload
 * shape: { text, attachments, blocks, username, icon_url }. This module turns a
 * raw parsed body into:
 *   - the message `body` (the text column on aaelink.messages), and
 *   - a `metadata` object stored in aaelink.messages.metadata (JSONB), holding
 *     the bot identity (username/icon) plus the rich content (attachments,
 *     blocks). Bot identity lives in metadata — the message row is still
 *     attributed to the webhook creator's user_id; metadata.is_bot marks it.
 *
 * Block Kit `blocks` are structurally validated via lib/blockkit/validate.ts;
 * malformed blocks are rejected so the receiver never stores garbage.
 */
import { validateBlocks, type BlockError } from '@/lib/blockkit/validate'

export interface WebhookMessageMetadata {
  is_bot: true
  bot_name: string
  bot_icon: string
  webhook_id: string
  attachments?: unknown[]
  blocks?: unknown[]
}

export type ParseInbound =
  | { ok: true; body: string; metadata: WebhookMessageMetadata }
  | { ok: false; error: string; status: number; details?: BlockError[] }

interface RawInbound {
  text?: unknown
  attachments?: unknown
  blocks?: unknown
  username?: unknown
  icon_url?: unknown
}

interface WebhookIdentity {
  id: string
  defaultName: string
  defaultIcon: string
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/**
 * Parse + validate a Slack-compatible incoming-webhook body.
 *
 * A message must carry at least one of: text, attachments, or blocks (Slack
 * permits a blocks/attachments-only message). Blocks are rejected when
 * structurally invalid; attachments are accepted as an opaque array (Slack
 * legacy attachments have no strict schema we enforce here).
 */
export function parseInboundPayload(raw: unknown, webhook: WebhookIdentity): ParseInbound {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'invalid_payload', status: 400 }
  }
  const b = raw as RawInbound

  const text = asString(b.text)

  let attachments: unknown[] | undefined
  if (b.attachments !== undefined) {
    if (!Array.isArray(b.attachments)) {
      return { ok: false, error: 'invalid_attachments', status: 400 }
    }
    if (b.attachments.length > 0) attachments = b.attachments
  }

  let blocks: unknown[] | undefined
  if (b.blocks !== undefined) {
    const result = validateBlocks(b.blocks)
    if (!result.ok) {
      return { ok: false, error: 'invalid_blocks', status: 400, details: result.errors }
    }
    if (Array.isArray(b.blocks) && b.blocks.length > 0) blocks = b.blocks
  }

  // Require at least one renderable part — empty payloads are rejected.
  if (!text && !attachments && !blocks) {
    return { ok: false, error: 'empty_payload', status: 400 }
  }

  const metadata: WebhookMessageMetadata = {
    is_bot: true,
    bot_name: asString(b.username) || webhook.defaultName,
    bot_icon: asString(b.icon_url) || webhook.defaultIcon,
    webhook_id: webhook.id,
  }
  if (attachments) metadata.attachments = attachments
  if (blocks) metadata.blocks = blocks

  return { ok: true, body: text, metadata }
}
