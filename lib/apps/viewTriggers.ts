/**
 * AAELink — single-use trigger_id ledger for interactive views (parity §28).
 *
 * Slack mints a short-lived, single-use trigger_id on every interaction; an app
 * must SPEND it to open or push a modal. Nothing in this codebase minted one
 * before (the interactivity ingress dispatches the payload but never hands back a
 * trigger), so this module IS the mint+consume ledger (aaelink.view_triggers).
 * Kept separate from lib/apps/views so each file stays small and the trigger
 * lifecycle is unit-testable on its own.
 */

import type { Pool } from 'pg'
import { randomUUID } from 'crypto'

/** A trigger_id is valid for this long after minting (Slack uses ~3s; we are lenient). */
export const TRIGGER_TTL_MS = 3 * 60_000

export interface MintTriggerArgs {
  botId: string | null
  userId: string
  channelId?: string | null
  workspaceId?: string | null
}

/** Mint a single-use trigger_id bound to the acting bot+user. */
export async function mintViewTrigger(pool: Pool, args: MintTriggerArgs, now = Date.now()): Promise<string> {
  const id = `Vt${randomUUID().replace(/-/g, '')}`
  await pool.query(
    `INSERT INTO aaelink.view_triggers
       (id, bot_id, user_id, channel_id, workspace_id, consumed_at, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, NULL, $6, $7)`,
    [id, args.botId, args.userId, args.channelId ?? null, args.workspaceId ?? null, now + TRIGGER_TTL_MS, now]
  )
  return id
}

export type ConsumeResult =
  | { ok: true; userId: string; channelId: string | null; workspaceId: string | null }
  | { ok: false; error: 'invalid_trigger_id' | 'trigger_expired' | 'trigger_already_used' }

/**
 * Atomically consume a trigger_id. Single-use: the UPDATE only matches an
 * un-consumed, unexpired row, so a reused or expired trigger affects zero rows
 * and is rejected. The acting user must own the trigger.
 */
export async function consumeViewTrigger(
  pool: Pool,
  triggerId: string,
  actingUserId: string,
  now = Date.now()
): Promise<ConsumeResult> {
  const { rows } = await pool.query<{ consumed_at: string | null; expires_at: string; user_id: string }>(
    `SELECT consumed_at::text AS consumed_at, expires_at::text AS expires_at, user_id
       FROM aaelink.view_triggers WHERE id = $1`,
    [triggerId]
  )
  const row = rows[0]
  if (!row || row.user_id !== actingUserId) return { ok: false, error: 'invalid_trigger_id' }
  if (row.consumed_at !== null) return { ok: false, error: 'trigger_already_used' }
  if (Number(row.expires_at) < now) return { ok: false, error: 'trigger_expired' }

  const upd = await pool.query<{ channel_id: string | null; workspace_id: string | null }>(
    `UPDATE aaelink.view_triggers SET consumed_at = $2
      WHERE id = $1 AND consumed_at IS NULL AND expires_at >= $2
      RETURNING channel_id, workspace_id`,
    [triggerId, now]
  )
  const u = upd.rows[0]
  if (!u) return { ok: false, error: 'trigger_already_used' }
  return { ok: true, userId: actingUserId, channelId: u.channel_id, workspaceId: u.workspace_id ?? null }
}
