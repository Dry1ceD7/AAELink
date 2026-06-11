import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isWorkspaceMember } from '@/lib/workspace/workspaceAccess'
import { getS3Client, getBucket, getObjectBytes, putObjectBytes } from '@/lib/infra/s3'
import { convertToPdf, isStirlingAvailable } from '@/lib/documents/stirlingPdf'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * POST /api/documents/[id]/convert — convert a document (DOCX/XLSX/PPTX/images)
 * to PDF via Stirling PDF. Returns the new PDF document metadata with a download URL.
 *
 * Returns: { document: { id, filename, url, size, contentType } }
 */
async function _POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  const s3 = getS3Client()
  if (!pool || !s3) return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  await ensureSchema()
  const { id: docId } = await ctx.params

  // Check Stirling availability
  if (!(await isStirlingAvailable())) {
    return NextResponse.json({ error: 'pdf_service_unavailable', detail: 'Stirling PDF is not running or unreachable.' }, { status: 503 })
  }

  // Load document
  const { rows: docRows } = await pool.query<{
    id: string; workspace_id: string; filename: string; content_type: string; bucket_key: string
  }>(`SELECT id, workspace_id, filename, content_type, bucket_key FROM aaelink.documents WHERE id = $1`, [docId])

  const doc = docRows[0]
  if (!doc) return NextResponse.json({ error: 'document_not_found' }, { status: 404 })
  if (!(await isWorkspaceMember(pool, uid, doc.workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Check if already PDF
  if (doc.content_type === 'application/pdf' || doc.filename.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json({
      document: {
        id: doc.id,
        filename: doc.filename,
        url: `/api/documents/${doc.id}/download`,
        already_pdf: true,
      }
    })
  }

  // Check if a converted version already exists
  const pdfFilename = doc.filename.replace(/\.[^.]+$/, '.pdf')
  const { rows: existingRows } = await pool.query<{ id: string; filename: string; size: number }>(
    `SELECT id, filename, size FROM aaelink.documents
     WHERE workspace_id = $1 AND filename = $2 AND content_type = 'application/pdf'
     ORDER BY created_at DESC LIMIT 1`,
    [doc.workspace_id, pdfFilename]
  )

  if (existingRows[0]) {
    return NextResponse.json({
      document: {
        id: existingRows[0].id,
        filename: existingRows[0].filename,
        url: `/api/documents/${existingRows[0].id}/download`,
        size: existingRows[0].size,
        cached: true,
      }
    })
  }

  try {
    // Download the original file from S3
    const bucket = getBucket()
    const fileBuffer = await getObjectBytes(s3, bucket, doc.bucket_key)

    // Convert via Stirling PDF
    const pdfBuffer = await convertToPdf(fileBuffer, doc.filename, doc.content_type)

    // Store the converted PDF
    const newDocId = randomUUID()
    const key = `documents/${newDocId}/${pdfFilename}`
    await putObjectBytes({ s3, bucket, key, body: pdfBuffer, contentType: 'application/pdf' })

    const now = Date.now()
    await pool.query(
      `INSERT INTO aaelink.documents (id, workspace_id, filename, content_type, size, bucket_key, created_at)
       VALUES ($1, $2, $3, 'application/pdf', $4, $5, $6)`,
      [newDocId, doc.workspace_id, pdfFilename, pdfBuffer.length, key, now]
    )

    // Link as a version of the source document
    const { rows: verRows } = await pool.query<{ max_ver: number }>(
      `SELECT COALESCE(MAX(version_number), 0)::int AS max_ver FROM aaelink.document_versions WHERE document_id = $1`,
      [docId]
    )
    const nextVer = (verRows[0]?.max_ver || 0) + 1

    await pool.query(
      `INSERT INTO aaelink.document_versions (id, document_id, version_number, file_key, filename, content_type, size_bytes, change_summary, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, 'application/pdf', $6, $7, $8, $9)`,
      [randomUUID(), docId, nextVer, key, pdfFilename, pdfBuffer.length, 'Converted to PDF', uid, now]
    )

    return NextResponse.json({
      document: {
        id: newDocId,
        filename: pdfFilename,
        url: `/api/documents/${newDocId}/download`,
        size: pdfBuffer.length,
        contentType: 'application/pdf',
        version: nextVer,
      }
    })
  } catch (e) {
    console.error('[documents/convert]', e)
    return NextResponse.json({
      error: 'conversion_failed',
      detail: e instanceof Error ? e.message : String(e)
    }, { status: 500 })
  }
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/documents/:id/convert', _POST)
