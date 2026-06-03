import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { resolvePublicLink } from '@/lib/files/publicLinks'

/**
 * GET /api/files/public/:token (D12) — resolve a public file link. No session:
 * this is the externally shareable endpoint. Returns file metadata; null/404
 * when the token is unknown, disabled, revoked, or external sharing is off.
 */
async function _GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const { token } = await ctx.params

  const file = await resolvePublicLink(pool, token)
  if (!file) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  return NextResponse.json({
    file: {
      id: file.file_id,
      filename: file.filename,
      content_type: file.content_type,
      size: file.size,
    },
  })
}

export const GET = tracedRoute('GET', '/api/files/public/:token', _GET)
