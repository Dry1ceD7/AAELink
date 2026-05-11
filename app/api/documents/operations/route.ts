import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { isWorkspaceMember } from '@/lib/workspaceAccess'
import { getS3Client, getBucket, getObjectBytes, putObjectBytes } from '@/lib/s3'
import { tracedRoute } from '@/lib/tracedRoute'
import {
  mergePdfs, splitPdf, rotatePdf, ocrPdf,
  convertToPdf, redactPdf, addWatermark, extractPages,
  isStirlingAvailable
} from '@/lib/stirlingPdf'

type Operation = 'merge' | 'split' | 'rotate' | 'ocr' | 'convert_to_pdf' | 'redact' | 'watermark' | 'extract_pages'

function isOperation(v: string): v is Operation {
  return ['merge', 'split', 'rotate', 'ocr', 'convert_to_pdf', 'redact', 'watermark', 'extract_pages'].includes(v)
}

/**
 * POST /api/documents/operations — execute a PDF operation.
 *
 * Body: {
 *   operation: Operation,
 *   document_ids: string[],     // for merge or single doc
 *   workspace_id: string,
 *   pages?: string,              // for split/extract: "1-3,5"
 *   angle?: number,              // for rotate: 90, 180, 270
 *   search_text?: string,        // for redact
 *   watermark_text?: string,     // for watermark
 *   output_name?: string,        // desired output filename
 * }
 */
async function _POST(req: NextRequest) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  const s3 = getS3Client()
  if (!pool || !s3) return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  await ensureSchema()

  // Check Stirling availability
  if (!(await isStirlingAvailable())) {
    return NextResponse.json({ error: 'pdf_service_unavailable' }, { status: 503 })
  }

  const body = (await req.json()) as {
    operation?: string
    document_ids?: string[]
    workspace_id?: string
    pages?: string
    angle?: number
    search_text?: string
    watermark_text?: string
    output_name?: string
    languages?: string[]
  }

  const operation = String(body.operation || '')
  if (!isOperation(operation)) {
    return NextResponse.json({ error: 'invalid_operation', valid: ['merge', 'split', 'rotate', 'ocr', 'convert_to_pdf', 'redact', 'watermark', 'extract_pages'] }, { status: 400 })
  }

  const workspaceId = String(body.workspace_id || '').trim()
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  if (!(await isWorkspaceMember(pool, uid, workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const docIds = Array.isArray(body.document_ids) ? body.document_ids : []
  if (docIds.length === 0) {
    return NextResponse.json({ error: 'document_ids_required' }, { status: 400 })
  }

  // Load documents from DB
  const placeholders = docIds.map((_, i) => `$${i + 1}`).join(', ')
  const { rows: docs } = await pool.query<{
    id: string; bucket_key: string; filename: string; content_type: string; workspace_id: string
  }>(`SELECT id, bucket_key, filename, content_type, workspace_id FROM aaelink.documents WHERE id IN (${placeholders})`, docIds)

  if (docs.length === 0) return NextResponse.json({ error: 'documents_not_found' }, { status: 404 })

  // Verify workspace ownership
  for (const doc of docs) {
    if (doc.workspace_id !== workspaceId) {
      return NextResponse.json({ error: 'document_workspace_mismatch' }, { status: 403 })
    }
  }

  const bucket = getBucket()

  try {
    let result: Buffer
    let outputFilename = body.output_name?.trim() || ''

    switch (operation) {
      case 'merge': {
        if (docs.length < 2) return NextResponse.json({ error: 'merge_requires_two_or_more' }, { status: 400 })
        const buffers = await Promise.all(docs.map(d => getObjectBytes(s3, bucket, d.bucket_key)))
        result = await mergePdfs(buffers)
        outputFilename = outputFilename || 'merged.pdf'
        break
      }

      case 'split': {
        const pages = String(body.pages || '').trim()
        if (!pages) return NextResponse.json({ error: 'pages_required' }, { status: 400 })
        const buf = await getObjectBytes(s3, bucket, docs[0].bucket_key)
        result = await splitPdf(buf, pages)
        outputFilename = outputFilename || `split_${docs[0].filename}`
        break
      }

      case 'rotate': {
        const angle = Number(body.angle || 90)
        if (![90, 180, 270].includes(angle)) {
          return NextResponse.json({ error: 'angle_must_be_90_180_or_270' }, { status: 400 })
        }
        const buf = await getObjectBytes(s3, bucket, docs[0].bucket_key)
        result = await rotatePdf(buf, angle)
        outputFilename = outputFilename || `rotated_${docs[0].filename}`
        break
      }

      case 'ocr': {
        const buf = await getObjectBytes(s3, bucket, docs[0].bucket_key)
        const languages = Array.isArray(body.languages) ? body.languages : ['eng']
        result = await ocrPdf(buf, languages)
        outputFilename = outputFilename || `ocr_${docs[0].filename}`
        break
      }

      case 'convert_to_pdf': {
        const buf = await getObjectBytes(s3, bucket, docs[0].bucket_key)
        result = await convertToPdf(buf, docs[0].filename, docs[0].content_type)
        outputFilename = outputFilename || docs[0].filename.replace(/\.[^.]+$/, '.pdf')
        break
      }

      case 'redact': {
        const searchText = String(body.search_text || '').trim()
        if (!searchText) return NextResponse.json({ error: 'search_text_required' }, { status: 400 })
        const buf = await getObjectBytes(s3, bucket, docs[0].bucket_key)
        result = await redactPdf(buf, searchText)
        outputFilename = outputFilename || `redacted_${docs[0].filename}`
        break
      }

      case 'watermark': {
        const text = String(body.watermark_text || '').trim()
        if (!text) return NextResponse.json({ error: 'watermark_text_required' }, { status: 400 })
        const buf = await getObjectBytes(s3, bucket, docs[0].bucket_key)
        result = await addWatermark(buf, text)
        outputFilename = outputFilename || `watermarked_${docs[0].filename}`
        break
      }

      case 'extract_pages': {
        const pages = String(body.pages || '').trim()
        if (!pages) return NextResponse.json({ error: 'pages_required' }, { status: 400 })
        const buf = await getObjectBytes(s3, bucket, docs[0].bucket_key)
        result = await extractPages(buf, pages)
        outputFilename = outputFilename || `extracted_${docs[0].filename}`
        break
      }

      default:
        return NextResponse.json({ error: 'unsupported_operation' }, { status: 400 })
    }

    // Save result as a new document
    const newDocId = randomUUID()
    const key = `documents/${newDocId}/${outputFilename}`
    await putObjectBytes({ s3, bucket, key, body: result, contentType: 'application/pdf' })

    const now = Date.now()
    await pool.query(
      `INSERT INTO aaelink.documents (id, workspace_id, filename, content_type, size, bucket_key, created_at)
       VALUES ($1, $2, $3, 'application/pdf', $4, $5, $6)`,
      [newDocId, workspaceId, outputFilename, result.length, key, now]
    )

    // Create version record linking to source document
    const sourceDocId = docs[0].id
    const { rows: verRows } = await pool.query<{ max_ver: number }>(
      `SELECT COALESCE(MAX(version_number), 0)::int AS max_ver FROM aaelink.document_versions WHERE document_id = $1`,
      [sourceDocId]
    )
    const nextVer = (verRows[0]?.max_ver || 0) + 1

    await pool.query(
      `INSERT INTO aaelink.document_versions (id, document_id, version_number, file_key, filename, content_type, size_bytes, change_summary, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, 'application/pdf', $6, $7, $8, $9)`,
      [randomUUID(), sourceDocId, nextVer, key, outputFilename, result.length, `${operation} operation`, uid, now]
    )

    return NextResponse.json({
      document: {
        id: newDocId,
        filename: outputFilename,
        contentType: 'application/pdf',
        size: result.length,
        createdAt: now,
        operation,
        source_documents: docIds,
        version: nextVer,
      }
    })
  } catch (e) {
    console.error('[documents/operations]', e)
    return NextResponse.json({
      error: 'operation_failed',
      detail: e instanceof Error ? e.message : String(e)
    }, { status: 500 })
  }
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/documents/operations', _POST)
