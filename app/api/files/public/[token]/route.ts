import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { resolvePublicLink } from '@/lib/files/publicLinks'
import { readFileBytes } from '@/lib/files/storage'
import { buildServeHeaders } from '@/lib/files/serveHeaders'

/**
 * GET /api/files/public/:token (D12) — public file link. No session: this is the
 * externally shareable endpoint. Slack parity: the URL renders the actual file,
 * so by default it serves the file bytes. ?meta=1 returns just the metadata JSON.
 *
 * resolvePublicLink enforces the scan gate (D12) and the org external-sharing
 * toggle exactly as before; it returns null when the token is unknown, disabled,
 * revoked, sharing is off, or the file is blocked by the scan policy.
 */
async function _GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const { token } = await ctx.params

  const file = await resolvePublicLink(pool, token)
  if (!file) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Metadata-only mode (backward compatible with metadata consumers).
  if (req.nextUrl.searchParams.get('meta') === '1') {
    return NextResponse.json({
      file: {
        id: file.file_id,
        filename: file.filename,
        content_type: file.content_type,
        size: file.size,
      },
    })
  }

  // Serve the actual bytes — same storage resolution as the authenticated
  // download path. This is the UNAUTHENTICATED surface, so active-content types
  // (text/html, SVG, …) are neutralized: they are forced to an attachment
  // download as application/octet-stream, with nosniff set on the response.
  const buffer = await readFileBytes(file.storage_key, file.storage_backend)
  if (!buffer) return NextResponse.json({ error: 'file_missing' }, { status: 404 })

  return new NextResponse(new Uint8Array(buffer), {
    headers: buildServeHeaders({
      contentType: file.content_type,
      filename: file.filename,
      size: buffer.length,
      cacheControl: 'public, max-age=3600',
    }),
  })
}

export const GET = tracedRoute('GET', '/api/files/public/:token', _GET)
