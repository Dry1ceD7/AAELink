// keep: enterprise admin surface kept for parity (intentional, not yet wired into UI)
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Team Billing API — Slack team.billing parity.
 *
 * GET /api/team/billing — get billing/subscription info for the workspace
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Check admin
  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'admin_required' }, { status: 403 })
  }

  const wsId = req.nextUrl.searchParams.get('workspace_id') || ''

  // Get workspace stats for billing context
  const userCount = await pool.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM aaelink.users`)
  const channelCount = await pool.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM aaelink.channels`)
  const fileCount = await pool.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM aaelink.file_attachments WHERE deleted_at = 0`)
  const messageCount = await pool.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM aaelink.messages`)

  // Storage usage
  const storageResult = await pool.query<{ total_bytes: string }>(
    `SELECT COALESCE(SUM(size), 0) AS total_bytes FROM aaelink.file_attachments WHERE deleted_at = 0`
  )

  return NextResponse.json({
    billing: {
      plan: 'enterprise',
      status: 'active',
      billing_email: 'billing@aae.co.th',
      currency: 'THB',
      usage: {
        users: userCount.rows[0]?.count || 0,
        channels: channelCount.rows[0]?.count || 0,
        files: fileCount.rows[0]?.count || 0,
        messages: messageCount.rows[0]?.count || 0,
        storage_bytes: Number(storageResult.rows[0]?.total_bytes || 0),
        storage_gb: Math.round(Number(storageResult.rows[0]?.total_bytes || 0) / 1073741824 * 100) / 100,
      },
      limits: {
        max_users: -1,           // unlimited
        max_channels: -1,
        max_storage_gb: 1000,
        max_file_size_mb: 100,
        message_retention_days: -1,
      },
    },
  })
}

export const GET = tracedRoute('GET', '/api/team/billing', _GET)
