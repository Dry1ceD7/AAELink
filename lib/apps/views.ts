/**
 * AAELink — interactive views/modals persistence (Integrations parity §28).
 *
 * Slack's views.open / views.push / views.update / views.publish, made real.
 * The route (app/api/views) is a thin session + RBAC + audit + realtime wrapper;
 * all view state lives here so it is unit-testable and reusable. The single-use
 * trigger_id lifecycle (mint/consume) lives in lib/apps/viewTriggers, re-exported
 * below so callers have one import surface.
 */

import type { Pool } from 'pg'
import { randomUUID } from 'crypto'

export {
  mintViewTrigger, consumeViewTrigger, TRIGGER_TTL_MS,
  type MintTriggerArgs, type ConsumeResult,
} from '@/lib/apps/viewTriggers'

// ── View persistence ─────────────────────────────────────────────────

export interface ViewPayload {
  type: 'modal' | 'home'
  title?: unknown
  blocks?: unknown[]
  submit?: unknown
  close?: unknown
  private_metadata?: string
  callback_id?: string
  clear_on_close?: boolean
  notify_on_close?: boolean
  external_id?: string
}

export interface PersistedView {
  id: string
  bot_id: string | null
  app_id: string | null
  user_id: string
  channel_id: string | null
  type: 'modal' | 'home'
  root_view_id: string
  parent_view_id: string | null
  external_id: string | null
  view: ViewPayload
  state: { values: Record<string, unknown> }
  hash: string
}

function newHash(now = Date.now()): string {
  return `${now}.${randomUUID().slice(0, 8)}`
}

const SELECT_COLS =
  `id, bot_id, app_id, user_id, channel_id, type, root_view_id, parent_view_id,
   external_id, view, state, hash`

interface ViewRow {
  id: string; bot_id: string | null; app_id: string | null; user_id: string
  channel_id: string | null; type: 'modal' | 'home'; root_view_id: string
  parent_view_id: string | null; external_id: string | null
  view: ViewPayload; state: { values: Record<string, unknown> }; hash: string
}

function rowToView(r: ViewRow): PersistedView {
  return { ...r }
}

export interface OpenArgs {
  botId: string | null; appId: string | null; userId: string
  channelId?: string | null; workspaceId?: string | null; view: ViewPayload
}

/** views.open — create a new root modal. */
export async function openView(pool: Pool, a: OpenArgs, now = Date.now()): Promise<PersistedView> {
  const id = `V${randomUUID().replace(/-/g, '')}`
  const { rows } = await pool.query<ViewRow>(
    `INSERT INTO aaelink.app_views
       (id, bot_id, app_id, user_id, channel_id, workspace_id, type, root_view_id,
        parent_view_id, external_id, view, state, hash, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$1,NULL,$8,$9,'{"values":{}}',$10,$11,$11)
     RETURNING ${SELECT_COLS}`,
    [id, a.botId, a.appId, a.userId, a.channelId ?? null, a.workspaceId ?? null,
      a.view.type === 'home' ? 'home' : 'modal', a.view.external_id || null,
      JSON.stringify(a.view), newHash(now), now]
  )
  return rowToView(rows[0])
}

export type StackResult =
  | { ok: true; view: PersistedView }
  | { ok: false; error: 'view_not_found' }

/** views.push — stack a new view on an existing modal's root. */
export async function pushView(
  pool: Pool, rootOrParentId: string, a: OpenArgs, now = Date.now()
): Promise<StackResult> {
  const { rows: base } = await pool.query<{ root_view_id: string; user_id: string }>(
    `SELECT root_view_id, user_id FROM aaelink.app_views
      WHERE id = $1 AND type = 'modal'
        AND bot_id IS NOT DISTINCT FROM $2
        AND user_id = $3`,
    [rootOrParentId, a.botId, a.userId]
  )
  const parent = base[0]
  if (!parent) return { ok: false, error: 'view_not_found' }
  const id = `V${randomUUID().replace(/-/g, '')}`
  const { rows } = await pool.query<ViewRow>(
    `INSERT INTO aaelink.app_views
       (id, bot_id, app_id, user_id, channel_id, workspace_id, type, root_view_id,
        parent_view_id, external_id, view, state, hash, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,'modal',$7,$8,$9,$10,'{"values":{}}',$11,$12,$12)
     RETURNING ${SELECT_COLS}`,
    [id, a.botId, a.appId, a.userId, a.channelId ?? null, a.workspaceId ?? null,
      parent.root_view_id, rootOrParentId, a.view.external_id || null,
      JSON.stringify(a.view), newHash(now), now]
  )
  return { ok: true, view: rowToView(rows[0]) }
}

/** views.update — mutate an existing view by id or external_id, scoped to the bot and user. */
export async function updateView(
  pool: Pool,
  args: { viewId?: string; externalId?: string; botId: string | null; userId: string; view: ViewPayload },
  now = Date.now()
): Promise<StackResult> {
  let query: string
  let params: unknown[]
  if (args.viewId) {
    // view_id branch: scope to bot_id AND user_id to prevent IDOR across actors
    query = `UPDATE aaelink.app_views SET view = $1, hash = $2, updated_at = $3
      WHERE id = $4
        AND bot_id IS NOT DISTINCT FROM $5
        AND user_id = $6
      RETURNING ${SELECT_COLS}`
    params = [JSON.stringify(args.view), newHash(now), now, args.viewId, args.botId, args.userId]
  } else {
    // external_id branch: already bot-scoped (unchanged)
    query = `UPDATE aaelink.app_views SET view = $1, hash = $2, updated_at = $3
      WHERE external_id = $4 AND bot_id IS NOT DISTINCT FROM $5
      RETURNING ${SELECT_COLS}`
    params = [JSON.stringify(args.view), newHash(now), now, args.externalId || '', args.botId]
  }
  const { rows } = await pool.query<ViewRow>(query, params)
  if (!rows[0]) return { ok: false, error: 'view_not_found' }
  return { ok: true, view: rowToView(rows[0]) }
}

/** views.publish — upsert the Home-tab view for (app/bot, user). */
export async function publishHomeView(
  pool: Pool, a: OpenArgs, now = Date.now()
): Promise<PersistedView> {
  const id = `V${randomUUID().replace(/-/g, '')}`
  const { rows } = await pool.query<ViewRow>(
    `INSERT INTO aaelink.app_views
       (id, bot_id, app_id, user_id, channel_id, workspace_id, type, root_view_id,
        parent_view_id, external_id, view, state, hash, created_at, updated_at)
     VALUES ($1,$2,$3,$4,NULL,$5,'home',$1,NULL,$6,$7,'{"values":{}}',$8,$9,$9)
     ON CONFLICT ((COALESCE(bot_id, '')), user_id) WHERE type = 'home'
       DO UPDATE SET view = EXCLUDED.view, hash = EXCLUDED.hash, updated_at = EXCLUDED.updated_at
     RETURNING ${SELECT_COLS}`,
    [id, a.botId, a.appId, a.userId, a.workspaceId ?? null,
      a.view.external_id || null, JSON.stringify(a.view), newHash(now), now]
  )
  return rowToView(rows[0])
}
