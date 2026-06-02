import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { listOrganizations, createOrganization, type OrgPlan } from '@/lib/enterprise/orgAdmin'

/**
 * GET  /api/admin/org — list all organizations
 * POST /api/admin/org — create a new organization
 */

async function _GET(_req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows } = await pool.query(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!isPlatformAdmin((rows[0] as { platform_role?: string })?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const orgs = await listOrganizations()
  return NextResponse.json({ organizations: orgs })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows } = await pool.query(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!isPlatformAdmin((rows[0] as { platform_role?: string })?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as {
    name?: string; domain?: string; plan?: OrgPlan
  }
  if (!body.name || !body.domain) {
    return NextResponse.json({ error: 'name_and_domain_required' }, { status: 400 })
  }

  const org = await createOrganization(body.name, body.domain, body.plan)
  if (!org) return NextResponse.json({ error: 'create_failed' }, { status: 500 })

  return NextResponse.json({ organization: org }, { status: 201 })
}

export const GET  = tracedRoute('GET',  '/api/admin/org', _GET)
export const POST = tracedRoute('POST', '/api/admin/org', _POST)
