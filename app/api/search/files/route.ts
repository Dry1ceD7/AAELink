// keep: slack-compat surface (intentionally addressable, may be invoked by Slack-shaped clients)
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * File Content Search API — search inside uploaded documents.
 *
 * GET  /api/search/files — search file content by text query
 * POST /api/search/files — submit file for content indexing
 *
 * Supported file types for indexing:
 *   - Text: .txt, .md, .csv, .json, .xml, .html
 *   - Documents: .pdf, .docx, .xlsx, .pptx (via extraction workers)
 *   - Code: .js, .ts, .py, .go, .java, .rb, .rs, .c, .cpp
 *
 * Index storage: pg_tsvector on file_index table for full-text search.
 * For scale: Elasticsearch/OpenSearch adapter planned for v0.3.0-beta.
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q')?.trim() || ''
  if (!q || q.length < 2) {
    return NextResponse.json({ error: 'query_min_2_chars' }, { status: 400 })
  }

  const channelId = req.nextUrl.searchParams.get('channel_id') || ''
  const fileType = req.nextUrl.searchParams.get('file_type') || ''
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 20, 50)

  // Build search query using pg full-text
  const tsQuery = q.split(/\s+/).map(w => w.replace(/[^a-zA-Z0-9]/g, '')).filter(Boolean).join(' & ')
  if (!tsQuery) return NextResponse.json({ results: [], total: 0 })

  let where = 'WHERE fi.search_vector @@ to_tsquery($1)'
  const params: (string | number)[] = [tsQuery]

  if (channelId) {
    params.push(channelId); where += ` AND fi.channel_id = $${params.length}`
  }
  if (fileType) {
    params.push(fileType); where += ` AND fi.file_type = $${params.length}`
  }
  params.push(limit)

  const { rows } = await pool.query(`
    SELECT fi.id, fi.file_id, fi.filename, fi.file_type, fi.channel_id,
           fi.uploaded_by, u.username AS uploaded_by_username,
           fi.indexed_at, fi.content_length,
           ts_rank(fi.search_vector, to_tsquery($1)) AS relevance,
           ts_headline('english', fi.content_preview, to_tsquery($1),
                       'StartSel=<mark>, StopSel=</mark>, MaxFragments=3, MaxWords=30'
           ) AS highlights
    FROM aaelink.file_index fi
    LEFT JOIN aaelink.users u ON u.id = fi.uploaded_by
    ${where}
    ORDER BY relevance DESC
    LIMIT $${params.length}
  `, params)

  return NextResponse.json({
    results: rows.map(r => ({ ...r, indexed_at: Number(r.indexed_at) })),
    total: rows.length,
    query: q,
  })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    file_id?: string; filename?: string; content?: string
    channel_id?: string; file_type?: string
  }

  const fileId = String(body.file_id || '').trim()
  if (!fileId) return NextResponse.json({ error: 'file_id_required' }, { status: 400 })

  const content = String(body.content || '').trim()
  if (!content) {
    // Enqueue an indexing job (worker will extract content)
    await pool.query(`
      INSERT INTO aaelink.jobs
        (id, type, status, priority, payload, run_after, max_retries, attempts, created_by, created_at)
      VALUES ($1, 'index_rebuild', 'pending', 6, $2, $3, 3, 0, $4, $3)
    `, [randomUUID(), JSON.stringify({ file_id: fileId }), Date.now(), uid])

    return NextResponse.json({ queued: true, file_id: fileId })
  }

  // Direct index (content provided)
  const id = randomUUID()
  const now = Date.now()
  const preview = content.slice(0, 5000) // Keep first 5000 chars for preview/highlighting

  await pool.query(`
    INSERT INTO aaelink.file_index
      (id, file_id, filename, file_type, channel_id, content_preview,
       content_length, search_vector, uploaded_by, indexed_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, to_tsvector('english', $6), $8, $9)
    ON CONFLICT (file_id) DO UPDATE SET
      content_preview = $6, content_length = $7,
      search_vector = to_tsvector('english', $6), indexed_at = $9
  `, [
    id, fileId, body.filename || '', body.file_type || '',
    body.channel_id || '', preview, content.length, uid, now
  ])

  return NextResponse.json({
    indexed: { id, file_id: fileId, content_length: content.length, indexed_at: now }
  }, { status: 201 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/search/files', _GET)
export const POST   = tracedRoute('POST', '/api/search/files', _POST)
