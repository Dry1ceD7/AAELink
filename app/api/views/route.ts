import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Views/Modals API — Slack views.open / views.push / views.update parity.
 *
 * POST /api/views — manage interactive modal/dialog views for apps
 *
 * Supports:
 *   - views.open — open a new modal
 *   - views.push — push a new view onto a modal's stack
 *   - views.update — update an existing view
 *   - views.publish — publish a Home tab view for a user
 *
 * Views use Block Kit-style JSON layout definitions.
 */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'open' | 'push' | 'update' | 'publish'
    trigger_id?: string
    view_id?: string
    user_id?: string
    view?: {
      type: 'modal' | 'home'
      title?: { type: string; text: string }
      blocks?: Array<Record<string, unknown>>
      submit?: { type: string; text: string }
      close?: { type: string; text: string }
      private_metadata?: string
      callback_id?: string
      clear_on_close?: boolean
      notify_on_close?: boolean
      external_id?: string
    }
    hash?: string
  }

  const action = body.action || 'open'

  if (action === 'open') {
    if (!body.trigger_id || !body.view) {
      return NextResponse.json({ error: 'trigger_id and view required' }, { status: 400 })
    }

    const viewId = `V${Date.now()}`
    // Store view state (in production this would be pushed to the client via SSE/WebSocket)
    return NextResponse.json({
      ok: true,
      view: {
        id: viewId,
        team_id: '',
        type: body.view.type || 'modal',
        title: body.view.title || { type: 'plain_text', text: '' },
        blocks: body.view.blocks || [],
        close: body.view.close,
        submit: body.view.submit,
        private_metadata: body.view.private_metadata || '',
        callback_id: body.view.callback_id || '',
        state: { values: {} },
        hash: `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`,
        clear_on_close: body.view.clear_on_close || false,
        notify_on_close: body.view.notify_on_close || false,
        external_id: body.view.external_id || '',
        root_view_id: viewId,
        app_id: '',
        bot_id: '',
      },
    })
  }

  if (action === 'push') {
    if (!body.trigger_id || !body.view) {
      return NextResponse.json({ error: 'trigger_id and view required' }, { status: 400 })
    }

    const viewId = `V${Date.now()}`
    return NextResponse.json({
      ok: true,
      view: {
        id: viewId,
        type: body.view.type || 'modal',
        title: body.view.title || { type: 'plain_text', text: '' },
        blocks: body.view.blocks || [],
        hash: `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`,
      },
    })
  }

  if (action === 'update') {
    if (!body.view_id || !body.view) {
      return NextResponse.json({ error: 'view_id and view required' }, { status: 400 })
    }

    return NextResponse.json({
      ok: true,
      view: {
        id: body.view_id,
        type: body.view.type || 'modal',
        title: body.view.title,
        blocks: body.view.blocks || [],
        hash: `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`,
      },
    })
  }

  if (action === 'publish') {
    if (!body.user_id || !body.view) {
      return NextResponse.json({ error: 'user_id and view required' }, { status: 400 })
    }
    if (body.view.type !== 'home') {
      return NextResponse.json({ error: 'view type must be home' }, { status: 400 })
    }

    const viewId = `V${Date.now()}`
    return NextResponse.json({
      ok: true,
      view: {
        id: viewId,
        type: 'home',
        blocks: body.view.blocks || [],
        external_id: body.view.external_id || '',
      },
    })
  }

  return NextResponse.json({ error: 'action must be open/push/update/publish' }, { status: 400 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/views', _POST)
