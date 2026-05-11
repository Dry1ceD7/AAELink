import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { isWorkspaceMember } from '@/lib/workspaceAccess'
import { getS3Client, getBucket, putObjectBytes } from '@/lib/s3'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * GET  /api/documents/[id]/signatures — list signature requests for a document.
 * POST /api/documents/[id]/signatures — create signing request or submit signature.
 */

async function _GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const { id: docId } = await ctx.params

  const { rows: docRows } = await pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.documents WHERE id = $1`, [docId]
  )
  if (!docRows[0]) return NextResponse.json({ error: 'document_not_found' }, { status: 404 })
  if (!(await isWorkspaceMember(pool, uid, docRows[0].workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { rows } = await pool.query<{
    id: string; document_id: string; signer_id: string; signing_order: number;
    status: string; signature_image_key: string; ip_address: string;
    user_agent: string; signed_at: number; created_at: number;
    signer_username: string; signer_avatar: string;
    signer_first_name: string; signer_last_name: string;
  }>(
    `SELECT s.*, u.username AS signer_username, u.avatar_url AS signer_avatar,
            u.first_name AS signer_first_name, u.last_name AS signer_last_name
     FROM aaelink.document_signatures s
     LEFT JOIN aaelink.users u ON u.id = s.signer_id
     WHERE s.document_id = $1
     ORDER BY s.signing_order, s.created_at`,
    [docId]
  )

  const allSigned = rows.length > 0 && rows.every(r => r.status === 'signed')
  const nextSigner = rows.find(r => r.status === 'pending')

  return NextResponse.json({
    signatures: rows.map(r => ({ ...r, signed_at: Number(r.signed_at), created_at: Number(r.created_at) })),
    summary: {
      total: rows.length,
      signed: rows.filter(r => r.status === 'signed').length,
      pending: rows.filter(r => r.status === 'pending').length,
      all_signed: allSigned,
      next_signer_id: nextSigner?.signer_id || null,
    }
  })
}

async function _POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  const s3 = getS3Client()
  if (!pool || !s3) return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  await ensureSchema()
  const { id: docId } = await ctx.params

  const { rows: docRows } = await pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.documents WHERE id = $1`, [docId]
  )
  if (!docRows[0]) return NextResponse.json({ error: 'document_not_found' }, { status: 404 })
  if (!(await isWorkspaceMember(pool, uid, docRows[0].workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as {
    action: 'request' | 'sign'
    signer_ids?: string[]
    signature_data?: string  // base64 PNG of signature
  }

  const now = Date.now()

  // ── Create signing request ──
  if (body.action === 'request') {
    const signerIds = Array.isArray(body.signer_ids) ? body.signer_ids : []
    if (signerIds.length === 0) {
      return NextResponse.json({ error: 'signer_ids_required' }, { status: 400 })
    }

    const created: string[] = []
    for (let i = 0; i < signerIds.length; i++) {
      const sigId = randomUUID()
      await pool.query(
        `INSERT INTO aaelink.document_signatures
          (id, document_id, signer_id, signing_order, status, created_at)
         VALUES ($1, $2, $3, $4, 'pending', $5)`,
        [sigId, docId, signerIds[i], i + 1, now]
      )
      created.push(sigId)
    }

    // Audit log
    await pool.query(
      `INSERT INTO aaelink.audit_log (id, actor_id, action, entity_type, entity_id, meta, created_at)
       VALUES ($1, $2, 'signature_requested', 'document', $3, $4, $5)`,
      [randomUUID(), uid, docId, JSON.stringify({ signers: signerIds, count: signerIds.length }), now]
    )

    return NextResponse.json({ ok: true, signature_ids: created, count: created.length })
  }

  // ── Submit signature ──
  if (body.action === 'sign') {
    // Find the pending signature for this user
    const { rows: pendingRows } = await pool.query<{ id: string; signing_order: number }>(
      `SELECT id, signing_order FROM aaelink.document_signatures
       WHERE document_id = $1 AND signer_id = $2 AND status = 'pending'
       ORDER BY signing_order LIMIT 1`,
      [docId, uid]
    )
    const pending = pendingRows[0]
    if (!pending) return NextResponse.json({ error: 'no_pending_signature' }, { status: 400 })

    // Check sequential order — ensure all previous signers have signed
    const { rows: priorRows } = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM aaelink.document_signatures
       WHERE document_id = $1 AND signing_order < $2 AND status != 'signed'`,
      [docId, pending.signing_order]
    )
    if (Number(priorRows[0]?.cnt || 0) > 0) {
      return NextResponse.json({ error: 'awaiting_prior_signers' }, { status: 400 })
    }

    // Save signature image if provided
    let sigImageKey = ''
    if (body.signature_data) {
      const sigBuffer = Buffer.from(body.signature_data, 'base64')
      sigImageKey = `signatures/${docId}/${uid}_${now}.png`
      await putObjectBytes({
        s3, bucket: getBucket(), key: sigImageKey,
        body: sigBuffer, contentType: 'image/png'
      })
    }

    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('x-real-ip') || '127.0.0.1'
    const userAgent = req.headers.get('user-agent') || ''

    await pool.query(
      `UPDATE aaelink.document_signatures
       SET status = 'signed', signature_image_key = $2, ip_address = $3,
           user_agent = $4, signed_at = $5
       WHERE id = $1`,
      [pending.id, sigImageKey, ipAddress, userAgent, now]
    )

    // Audit trail
    await pool.query(
      `INSERT INTO aaelink.audit_log (id, actor_id, action, entity_type, entity_id, ip_address, user_agent, meta, created_at)
       VALUES ($1, $2, 'document_signed', 'document', $3, $4, $5, $6, $7)`,
      [randomUUID(), uid, docId, ipAddress, userAgent,
       JSON.stringify({ signature_id: pending.id, signing_order: pending.signing_order }), now]
    )

    return NextResponse.json({
      ok: true,
      signature: {
        id: pending.id,
        status: 'signed',
        signed_at: now,
        signing_order: pending.signing_order,
      }
    })
  }

  return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/documents/:id/signatures', _GET)
export const POST   = tracedRoute('POST', '/api/documents/:id/signatures', _POST)
