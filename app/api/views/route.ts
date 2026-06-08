import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import type { Pool } from 'pg'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { getPubSub, userTopic } from '@/lib/realtime/redisPubSub'
import { validateBlocks } from '@/lib/blockkit/validate'
import {
  consumeViewTrigger, openView, pushView, updateView, publishHomeView,
  type ViewPayload, type PersistedView,
} from '@/lib/apps/views'

/**
 * Views/Modals API (Integrations parity §28) — Slack views.open / views.push /
 * views.update / views.publish, made real: persisted, trigger_id-gated, and
 * pushed to the target client over realtime.
 *
 * POST /api/views { action, trigger_id?, view_id?, external_id?, user_id?, bot_id?, view }
 *
 * RBAC — session-authenticated. When bot_id is supplied the session user must
 * OWN that bot (bot_users.created_by); the bot then acts. open/push spend a
 * single-use trigger_id (lib/apps/views). All view block payloads are structurally
 * validated (lib/blockkit/validate) before persistence. The opened/pushed/updated/
 * published view is emitted to the bound user over redisPubSub (userTopic) — the
 * "in production pushed via SSE/WebSocket" comment, realized.
 */

interface Body {
  action?: 'open' | 'push' | 'update' | 'publish'
  trigger_id?: string
  view_id?: string
  external_id?: string
  user_id?: string
  bot_id?: string
  view?: ViewPayload
}

/** Resolve the acting bot (if any) and assert the session user owns it. */
async function resolveActor(
  pool: Pool, uid: string, botId?: string
): Promise<{ ok: true; botId: string | null; appId: string | null; workspaceId: string | null } | NextResponse> {
  if (!botId) return { ok: true, botId: null, appId: null, workspaceId: null }
  const { rows } = await pool.query<{ created_by: string | null; workspace_id: string | null }>(
    `SELECT created_by, workspace_id FROM aaelink.bot_users WHERE id = $1`, [botId]
  )
  const bot = rows[0]
  if (!bot) return NextResponse.json({ error: 'bot_not_found' }, { status: 404 })
  if (bot.created_by !== uid) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  return { ok: true, botId, appId: null, workspaceId: bot.workspace_id }
}

/** Structural Block Kit gate. Returns a 400 response when invalid, else null. */
function rejectBadBlocks(view: ViewPayload | undefined): NextResponse | null {
  const blocks = view?.blocks
  if (blocks === undefined) return null
  const res = validateBlocks(blocks)
  if (!res.ok) return NextResponse.json({ error: 'invalid_blocks', details: res.errors }, { status: 400 })
  return null
}

/** Emit the view to the bound user's realtime topic. Best-effort. */
async function emitView(action: string, userId: string, view: PersistedView): Promise<void> {
  try {
    await getPubSub().publish(userTopic(userId), {
      type: 'notification', user_id: userId,
      payload: { kind: 'view', action, view },
    })
  } catch { /* realtime fan-out is best-effort; persistence already succeeded */ }
}

async function audit(pool: Pool, uid: string, action: string, viewId: string): Promise<void> {
  const now = Date.now()
  try {
    await pool.query(`
      INSERT INTO aaelink.audit_log (id, actor_id, action, resource_kind, resource_id, metadata, created_at)
      VALUES ($1, $2, $3, 'view', $4, $5, $6)
    `, [randomUUID(), uid, `views.${action}`, viewId, JSON.stringify({ action }), now])
  } catch { /* audit failures must never break the request path */ }
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Body
  const action = body.action || 'open'

  const actor = await resolveActor(pool, uid, body.bot_id)
  if (actor instanceof NextResponse) return actor

  if (action === 'open' || action === 'push') {
    if (!body.trigger_id || !body.view) {
      return NextResponse.json({ error: 'trigger_id_and_view_required' }, { status: 400 })
    }
    const bad = rejectBadBlocks(body.view)
    if (bad) return bad

    const consumed = await consumeViewTrigger(pool, body.trigger_id, uid)
    if (!consumed.ok) return NextResponse.json({ error: consumed.error }, { status: 400 })

    const common = {
      botId: actor.botId, appId: actor.appId, userId: uid,
      channelId: consumed.channelId, workspaceId: consumed.workspaceId ?? actor.workspaceId,
      view: body.view,
    }

    if (action === 'open') {
      const view = await openView(pool, common)
      await emitView('open', uid, view)
      await audit(pool, uid, 'open', view.id)
      return NextResponse.json({ ok: true, view })
    }
    // push — requires an existing root modal to stack onto
    if (!body.view_id) return NextResponse.json({ error: 'view_id_required' }, { status: 400 })
    const pushed = await pushView(pool, body.view_id, common)
    if (!pushed.ok) return NextResponse.json({ error: pushed.error }, { status: 404 })
    await emitView('push', uid, pushed.view)
    await audit(pool, uid, 'push', pushed.view.id)
    return NextResponse.json({ ok: true, view: pushed.view })
  }

  if (action === 'update') {
    if ((!body.view_id && !body.external_id) || !body.view) {
      return NextResponse.json({ error: 'view_id_or_external_id_and_view_required' }, { status: 400 })
    }
    const bad = rejectBadBlocks(body.view)
    if (bad) return bad
    const updated = await updateView(pool, {
      viewId: body.view_id, externalId: body.external_id,
      botId: actor.botId, userId: uid, view: body.view,
    })
    if (!updated.ok) return NextResponse.json({ error: updated.error }, { status: 404 })
    await emitView('update', updated.view.user_id, updated.view)
    await audit(pool, uid, 'update', updated.view.id)
    return NextResponse.json({ ok: true, view: updated.view })
  }

  if (action === 'publish') {
    if (!body.user_id || !body.view) {
      return NextResponse.json({ error: 'user_id_and_view_required' }, { status: 400 })
    }
    if (body.view.type !== 'home') {
      return NextResponse.json({ error: 'view_type_must_be_home' }, { status: 400 })
    }
    const bad = rejectBadBlocks(body.view)
    if (bad) return bad
    const view = await publishHomeView(pool, {
      botId: actor.botId, appId: actor.appId, userId: body.user_id,
      workspaceId: actor.workspaceId, view: body.view,
    })
    await emitView('publish', body.user_id, view)
    await audit(pool, uid, 'publish', view.id)
    return NextResponse.json({ ok: true, view })
  }

  return NextResponse.json({ error: 'action_must_be_open_push_update_publish' }, { status: 400 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST = tracedRoute('POST', '/api/views', _POST)
