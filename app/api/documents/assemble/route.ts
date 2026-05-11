import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { isWorkspaceMember } from '@/lib/workspaceAccess'
import { getS3Client, getBucket, getObjectBytes, putObjectBytes } from '@/lib/s3'
import { resolveTemplate, contextFromClientProfile, batchFindReplace, type FindReplaceRule, type TemplateContext } from '@/lib/templateEngine'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * POST /api/documents/assemble — generate a document from a template + client profile.
 *
 * Body: {
 *   workspace_id: string,
 *   template_id: string,
 *   client_id?: string,
 *   ticket_id?: string,
 *   custom_vars?: Record<string, string>,
 *   find_replace?: FindReplaceRule[],
 *   output_name?: string,
 * }
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
    template_id?: string
    client_id?: string
    ticket_id?: string
    custom_vars?: Record<string, string>
    find_replace?: FindReplaceRule[]
    output_name?: string
  }

  const workspaceId = String(body.workspace_id || '').trim()
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  if (!(await isWorkspaceMember(pool, uid, workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const templateId = String(body.template_id || '').trim()
  if (!templateId) return NextResponse.json({ error: 'template_id_required' }, { status: 400 })

  // Load template
  const { rows: tmplRows } = await pool.query<{
    id: string; file_key: string; filename: string; content_type: string; workspace_id: string; placeholders: string
  }>(`SELECT * FROM aaelink.document_templates WHERE id = $1`, [templateId])
  const tmpl = tmplRows[0]
  if (!tmpl) return NextResponse.json({ error: 'template_not_found' }, { status: 404 })
  if (tmpl.workspace_id !== workspaceId) {
    return NextResponse.json({ error: 'template_workspace_mismatch' }, { status: 403 })
  }

  // Build context
  const context: TemplateContext = { custom: {} }

  // Load client profile if specified
  if (body.client_id) {
    const { rows: clientRows } = await pool.query<Record<string, unknown>>(
      `SELECT * FROM aaelink.client_profiles WHERE id = $1 AND workspace_id = $2`,
      [body.client_id, workspaceId]
    )
    if (clientRows[0]) {
      const clientCtx = contextFromClientProfile(clientRows[0])
      context.client = clientCtx.client
    }
  }

  // Load ticket if specified
  if (body.ticket_id) {
    const { rows: ticketRows } = await pool.query<{
      id: string; title: string; status: string; priority: string; category: string
    }>(`SELECT id, title, status, priority, category FROM aaelink.tickets WHERE id = $1`, [body.ticket_id])
    if (ticketRows[0]) {
      context.ticket = ticketRows[0]
    }
  }

  // Load user info
  const { rows: userRows } = await pool.query<{
    username: string; first_name: string; last_name: string; email: string; job_title: string; phone: string
  }>(`SELECT username, first_name, last_name, email, job_title, phone FROM aaelink.users WHERE id = $1`, [uid])
  if (userRows[0]) {
    context.user = userRows[0]
  }

  // Merge custom vars
  if (body.custom_vars && typeof body.custom_vars === 'object') {
    context.custom = Object.fromEntries(
      Object.entries(body.custom_vars).map(([k, v]) => [k, String(v)])
    )
  }

  const bucket = getBucket()

  try {
    // Load template file
    let fileBuffer = await getObjectBytes(s3, bucket, tmpl.file_key)

    // For text-based formats (HTML templates, markdown, CSV), do direct placeholder resolution
    const isTextFormat = ['text/', 'application/json', 'text/html', 'text/markdown', 'text/csv'].some(
      t => tmpl.content_type.startsWith(t)
    )

    if (isTextFormat) {
      let content = fileBuffer.toString('utf-8')
      content = resolveTemplate(content, context)

      // Apply batch find & replace if provided
      if (Array.isArray(body.find_replace) && body.find_replace.length > 0) {
        content = batchFindReplace(content, body.find_replace)
      }

      fileBuffer = Buffer.from(content, 'utf-8')
    } else {
      // For binary formats (docx, pdf), we do batch find/replace on the raw text content
      // This is a best-effort approach — for DOCX XML content, we can do text replacement
      if (tmpl.content_type.includes('wordprocessingml') || tmpl.filename.endsWith('.docx')) {
        // DOCX files are ZIP archives containing XML. For simple text substitution,
        // we can search/replace within the raw buffer as a UTF-8 string representation.
        // This preserves formatting as long as placeholder text isn't split across XML tags.
        let content = fileBuffer.toString('binary')

        // Apply template placeholders
        content = resolveTemplate(content, context)

        // Apply batch find & replace
        if (Array.isArray(body.find_replace) && body.find_replace.length > 0) {
          content = batchFindReplace(content, body.find_replace)
        }

        fileBuffer = Buffer.from(content, 'binary')
      }
    }

    // Save assembled document
    const outputName = body.output_name?.trim() ||
      `${tmpl.filename.replace(/\.[^.]+$/, '')}_${context.client?.name?.replace(/\s+/g, '_') || 'assembled'}${tmpl.filename.match(/\.[^.]+$/)?.[0] || '.pdf'}`

    const newDocId = randomUUID()
    const key = `documents/${newDocId}/${outputName}`
    await putObjectBytes({ s3, bucket, key, body: fileBuffer, contentType: tmpl.content_type })

    const now = Date.now()

    // Save as new document
    await pool.query(
      `INSERT INTO aaelink.documents (id, workspace_id, filename, content_type, size, bucket_key, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [newDocId, workspaceId, outputName, tmpl.content_type, fileBuffer.length, key, now]
    )

    // Create version record linked to client/ticket
    await pool.query(
      `INSERT INTO aaelink.document_versions
        (id, document_id, version_number, file_key, filename, content_type, size_bytes,
         change_summary, created_by, client_profile_id, ticket_id, created_at)
       VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [randomUUID(), newDocId, key, outputName, tmpl.content_type, fileBuffer.length,
       `Assembled from template "${tmpl.filename}"`,
       uid, body.client_id || '', body.ticket_id || '', now]
    )

    return NextResponse.json({
      document: {
        id: newDocId,
        filename: outputName,
        contentType: tmpl.content_type,
        size: fileBuffer.length,
        createdAt: now,
        template_id: templateId,
        client_id: body.client_id || null,
        ticket_id: body.ticket_id || null,
      }
    })
  } catch (e) {
    console.error('[documents/assemble]', e)
    return NextResponse.json({
      error: 'assembly_failed',
      detail: e instanceof Error ? e.message : String(e)
    }, { status: 500 })
  }
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/documents/assemble', _POST)
