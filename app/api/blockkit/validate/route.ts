import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { validateBlocks } from '@/lib/blockkit/validate'

/**
 * POST /api/blockkit/validate (D7) — validate a Block Kit block array.
 * Body: { blocks }. Returns { ok, errors }. A developer tool; no side effects.
 */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { blocks?: unknown }
  const result = validateBlocks(body.blocks)
  return NextResponse.json(result, { status: result.ok ? 200 : 422 })
}

export const POST = tracedRoute('POST', '/api/blockkit/validate', _POST)
