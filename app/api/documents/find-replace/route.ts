import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { isWorkspaceMember } from '@/lib/workspaceAccess'
import { getS3Client, getBucket, getObjectBytes, putObjectBytes } from '@/lib/s3'
import { batchFindReplace, type FindReplaceRule } from '@/lib/templateEngine'
import { randomUUID } from 'crypto'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * POST /api/documents/find-replace — batch find & replace across one or more documents.
 *
 * Body: {
 *   workspace_id: string,
 *   document_ids: string[],
 *   rules: FindReplaceRule[],
 *   create_version?: boolean,    // default true — create new version after replacement
 * }
 *
 * Returns: { results: { document_id: string, filename: string, replacements: number, status: string }[] }
 */
async function _POST(req: NextRequest) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  const s3 = getS3Client()
  if (!pool || !s3) return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  await ensureSchema()

  const body = (await req.json()) as {
    workspace_id?: string
    document_ids?: string[]
    rules?: FindReplaceRule[]
    create_version?: boolean
  }

  const workspaceId = String(body.workspace_id || '').trim()
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  if (!(await isWorkspaceMember(pool, uid, workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (!Array.isArray(body.document_ids) || body.document_ids.length === 0) {
    return NextResponse.json({ error: 'document_ids_required' }, { status: 400 })
  }
  if (!Array.isArray(body.rules) || body.rules.length === 0) {
    return NextResponse.json({ error: 'rules_required' }, { status: 400 })
  }

  // Validate rules
  const rules = body.rules.filter(r => r.find && r.find.trim())
  if (rules.length === 0) {
    return NextResponse.json({ error: 'no_valid_rules' }, { status: 400 })
  }

  const createVersion = body.create_version !== false
  const bucket = getBucket()
  const results: Array<{ document_id: string; filename: string; replacements: number; status: string }> = []

  for (const docId of body.document_ids) {
    try {
      // Load document record
      const { rows: docRows } = await pool.query<{
        id: string; filename: string; content_type: string; bucket_key: string; workspace_id: string
      }>(`SELECT id, filename, content_type, bucket_key, workspace_id FROM aaelink.documents WHERE id = $1`, [docId])

      const doc = docRows[0]
      if (!doc || doc.workspace_id !== workspaceId) {
        results.push({ document_id: docId, filename: '', replacements: 0, status: 'not_found' })
        continue
      }

      // Load file from S3
      const fileBuffer = await getObjectBytes(s3, bucket, doc.bucket_key)

      // Determine if text-based
      const isText = ['text/', 'application/json'].some(t => doc.content_type.startsWith(t)) ||
        doc.filename.match(/\.(txt|csv|html|htm|md|json|xml|yaml|yml)$/i)

      const isDocx = doc.content_type.includes('wordprocessingml') || doc.filename.endsWith('.docx')

      let content: string
      let encoding: BufferEncoding

      if (isText) {
        content = fileBuffer.toString('utf-8')
        encoding = 'utf-8'
      } else if (isDocx) {
        content = fileBuffer.toString('binary')
        encoding = 'binary'
      } else {
        results.push({ document_id: docId, filename: doc.filename, replacements: 0, status: 'unsupported_format' })
        continue
      }

      // Count replacements
      let totalReplacements = 0
      for (const rule of rules) {
        const escaped = rule.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const pattern = rule.whole_word ? `\\b${escaped}\\b` : escaped
        const flags = rule.case_sensitive ? 'g' : 'gi'
        const re = new RegExp(pattern, flags)
        const matches = content.match(re)
        totalReplacements += matches?.length || 0
      }

      // Apply find & replace
      const replaced = batchFindReplace(content, rules)

      if (replaced === content) {
        results.push({ document_id: docId, filename: doc.filename, replacements: 0, status: 'no_changes' })
        continue
      }

      const newBuffer = Buffer.from(replaced, encoding)

      if (createVersion) {
        // Create a new version
        const { rows: versionCount } = await pool.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM aaelink.document_versions WHERE document_id = $1`, [docId]
        )
        const nextVersion = Number(versionCount[0]?.cnt || 0) + 1
        const versionKey = `documents/${docId}/v${nextVersion}/${doc.filename}`

        await putObjectBytes({ s3, bucket, key: versionKey, body: newBuffer, contentType: doc.content_type })

        const now = Date.now()
        await pool.query(
          `INSERT INTO aaelink.document_versions
           (id, document_id, version_number, file_key, filename, content_type, size_bytes, change_summary, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [randomUUID(), docId, nextVersion, versionKey, doc.filename, doc.content_type, newBuffer.length,
           `Batch find & replace: ${rules.map(r => `"${r.find}" → "${r.replace}"`).join(', ')}`,
           uid, now]
        )
      }

      // Update the main document file
      await putObjectBytes({ s3, bucket, key: doc.bucket_key, body: newBuffer, contentType: doc.content_type })
      await pool.query(`UPDATE aaelink.documents SET size = $1 WHERE id = $2`, [newBuffer.length, docId])

      results.push({
        document_id: docId,
        filename: doc.filename,
        replacements: totalReplacements,
        status: 'success',
      })
    } catch (e) {
      console.error(`[find-replace] Error processing ${docId}:`, e)
      results.push({
        document_id: docId,
        filename: '',
        replacements: 0,
        status: `error: ${e instanceof Error ? e.message : String(e)}`,
      })
    }
  }

  const totalDocs = results.filter(r => r.status === 'success').length
  const totalReplacements = results.reduce((sum, r) => sum + r.replacements, 0)

  return NextResponse.json({
    results,
    summary: { documents_processed: totalDocs, total_replacements: totalReplacements },
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/documents/find-replace', _POST)
