import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { renderEmail, listEmailTemplates } from '@/lib/emailTemplates'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Email Templates API — preview, send, and manage branded email templates.
 *
 * GET  /api/notifications/email/templates — list templates or preview rendered HTML
 * POST /api/notifications/email/templates — send a templated email
 *
 * Admin-only endpoints for:
 *   - Previewing emails with sample data
 *   - Sending test emails
 *   - Triggering transactional emails programmatically
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const template = req.nextUrl.searchParams.get('template') || ''
  const preview = req.nextUrl.searchParams.get('preview') === 'true'

  // List all templates
  if (!template) {
    const templates = listEmailTemplates()
    return NextResponse.json({
      templates: templates.map(name => ({
        name,
        preview_url: `/api/notifications/email/templates?template=${name}&preview=true`,
      }))
    })
  }

  // Preview a specific template with sample data
  const sampleData: Record<string, Record<string, string | number>> = {
    welcome: { username: 'Alice Chen', loginUrl: 'https://aaelink.aae.co.th' },
    mfa_enrolled: { username: 'Alice Chen', method: 'totp' },
    password_reset: { username: 'Alice Chen', resetUrl: 'https://aaelink.aae.co.th/reset?token=abc', expiresIn: '1 hour' },
    invite: { inviterName: 'Bob Smith', workspaceName: 'Engineering', inviteUrl: 'https://aaelink.aae.co.th/invite/xyz' },
    digest: { username: 'Alice Chen', unreadChannels: 5, unreadDMs: 3, mentionCount: 12, loginUrl: 'https://aaelink.aae.co.th' },
    legal_hold: { username: 'Alice Chen', holdName: 'Q2 Compliance Review', startDate: '2026-05-01' },
    otp: { username: 'Alice Chen', code: '847291', expiresIn: '10 minutes' },
    new_device_login: { username: 'Alice Chen', deviceName: 'MacBook Pro', ipAddress: '192.168.11.42', location: 'Bangkok, TH', loginTime: '2026-05-06 22:30 UTC+7' },
  }

  try {
    const vars = sampleData[template] || { username: 'Test User' }
    const result = renderEmail(template, vars)

    if (preview) {
      // Return raw HTML for browser preview
      return new NextResponse(result.html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    return NextResponse.json({
      template,
      subject: result.subject,
      html_length: result.html.length,
      sample_vars: vars,
    })
  } catch (err: unknown) {
    return NextResponse.json({
      error: 'template_not_found',
      available: listEmailTemplates(),
    }, { status: 404 })
  }
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    template?: string
    to_email?: string; to_user_id?: string
    vars?: Record<string, string | number>
  }

  const template = String(body.template || '').trim()
  if (!template) return NextResponse.json({ error: 'template_required', available: listEmailTemplates() }, { status: 400 })

  let toEmail = String(body.to_email || '').trim()

  // Resolve user email if to_user_id provided
  if (!toEmail && body.to_user_id) {
    const { rows } = await pool.query<{ email: string }>(
      `SELECT email FROM aaelink.users WHERE id = $1`, [body.to_user_id]
    )
    toEmail = rows[0]?.email || ''
  }

  if (!toEmail) return NextResponse.json({ error: 'to_email_or_to_user_id_required' }, { status: 400 })

  try {
    const result = renderEmail(template, body.vars || {})
    const id = randomUUID()
    const now = Date.now()

    // Queue email
    await pool.query(`
      INSERT INTO aaelink.jobs
        (id, type, status, priority, payload, run_after, max_retries, attempts, created_by, created_at)
      VALUES ($1, 'email_send', 'pending', 5, $2, $3, 3, 0, $4, $3)
    `, [id, JSON.stringify({
      to: toEmail,
      subject: result.subject,
      html: result.html,
      template,
    }), now, uid])

    return NextResponse.json({
      queued: true,
      job_id: id,
      to: toEmail,
      subject: result.subject,
      template,
    }, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({
      error: 'template_render_failed',
      message: err instanceof Error ? err.message : 'Unknown',
      available: listEmailTemplates(),
    }, { status: 400 })
  }
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/notifications/email/templates', _GET)
export const POST   = tracedRoute('POST', '/api/notifications/email/templates', _POST)
