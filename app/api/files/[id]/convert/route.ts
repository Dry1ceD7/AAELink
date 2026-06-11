import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isWorkspaceMember } from '@/lib/workspace/workspaceAccess'
import { userCanReadChannel } from '@/lib/enterprise/collab-access'
import { isFileAccessAllowed } from '@/lib/files/scanGate'
import { readFileBytes } from '@/lib/files/storage'
import { buildServeHeaders } from '@/lib/files/serveHeaders'
import { convertToPdf, isStirlingAvailable } from '@/lib/documents/stirlingPdf'
import { writeAuditLog } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * GET /api/files/[id]/convert — convert an Office/document file attachment
 * (DOCX/XLSX/PPTX/ODT/RTF/…) to PDF via Stirling PDF and stream the PDF bytes
 * inline so the file preview modal can render it through its existing PDF iframe
 * path. Mirrors the documents convert route (app/api/documents/[id]/convert),
 * but resolves the source bytes from file_attachments via the storage backend
 * recorded on the row instead of the aaelink.documents table.
 *
 * Read-shaped (no persisted row, no mutation) so no CSRF gate is required; it
 * reuses the same auth + access model as the download route.
 */
async function _GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await ctx.params

  const { rows } = await pool.query<{
    filename: string; content_type: string; storage_key: string
    storage_backend: string | null; workspace_id: string | null
    user_id: string; channel_id: string | null; deleted_at: string
  }>(
    `SELECT filename, content_type, storage_key, storage_backend, workspace_id,
            user_id, channel_id, deleted_at::text
       FROM aaelink.file_attachments WHERE id = $1`,
    [id]
  )
  const att = rows[0]
  if (!att || Number(att.deleted_at) !== 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // Access mirrors the download route: the uploader always; channel-attached
  // files require channel read access; workspace members of the file's
  // workspace may also read. Unattached uploads stay private to the uploader.
  if (att.user_id !== uid) {
    const channelOk = att.channel_id
      ? await userCanReadChannel(pool, uid, att.channel_id)
      : false
    const workspaceOk = att.workspace_id
      ? await isWorkspaceMember(pool, uid, att.workspace_id)
      : false
    if (!channelOk && !workspaceOk) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }

  // Virus-scan gate: never convert/serve a file that failed (or has not passed)
  // the scan policy.
  if (!(await isFileAccessAllowed(pool, id))) {
    return NextResponse.json({ error: 'file_blocked_by_scan' }, { status: 403 })
  }

  // Already a PDF — stream the original bytes through the same inline path.
  const isPdf = att.content_type === 'application/pdf' || att.filename.toLowerCase().endsWith('.pdf')
  if (isPdf) {
    const buffer = await readFileBytes(att.storage_key, att.storage_backend)
    if (!buffer) return NextResponse.json({ error: 'file_missing' }, { status: 404 })
    return new NextResponse(new Uint8Array(buffer), {
      headers: buildServeHeaders({
        contentType: 'application/pdf',
        filename: att.filename,
        size: buffer.length,
        cacheControl: 'private, max-age=3600',
      }),
    })
  }

  if (!(await isStirlingAvailable())) {
    return NextResponse.json(
      { error: 'pdf_service_unavailable', detail: 'Stirling PDF is not running or unreachable.' },
      { status: 503 }
    )
  }

  const fileBuffer = await readFileBytes(att.storage_key, att.storage_backend)
  if (!fileBuffer) return NextResponse.json({ error: 'file_missing' }, { status: 404 })

  try {
    const pdfBuffer = await convertToPdf(fileBuffer, att.filename, att.content_type)
    const pdfFilename = att.filename.replace(/\.[^.]+$/, '.pdf')

    writeAuditLog({
      pool,
      workspaceId: att.workspace_id ?? undefined,
      actorId: uid,
      action: 'file.convert',
      resourceKind: 'file_attachment',
      resourceId: id,
      metadata: { source_content_type: att.content_type, target: 'application/pdf' },
    })

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: buildServeHeaders({
        contentType: 'application/pdf',
        filename: pdfFilename,
        size: pdfBuffer.length,
        cacheControl: 'private, max-age=3600',
      }),
    })
  } catch (e) {
    console.error('[files/convert]', e)
    return NextResponse.json(
      { error: 'conversion_failed', detail: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET = tracedRoute('GET', '/api/files/:id/convert', _GET)
