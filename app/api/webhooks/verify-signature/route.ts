import { NextResponse } from 'next/server'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'
import {
  verifySignature,
  generateSigningSecret,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from '@/lib/webhookSigning'

// ── POST — verify a webhook signature ────────────────────────────────
async function _POST(req: Request) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json()) as {
    action?: 'verify' | 'generate_secret'
    secret?: string
    payload?: string
    signature?: string
    timestamp?: string | number
  }

  const action = body.action || 'verify'

  if (action === 'generate_secret') {
    const secret = generateSigningSecret()
    return NextResponse.json({ secret })
  }

  if (action === 'verify') {
    if (!body.secret || !body.payload || !body.signature || body.timestamp === undefined) {
      return NextResponse.json({
        error: 'missing_fields',
        required: ['secret', 'payload', 'signature', 'timestamp'],
        headers: { signature: SIGNATURE_HEADER, timestamp: TIMESTAMP_HEADER },
      }, { status: 400 })
    }

    const result = verifySignature(
      body.secret,
      body.payload,
      body.signature,
      body.timestamp,
    )

    return NextResponse.json({
      ...result,
      headers: { signature: SIGNATURE_HEADER, timestamp: TIMESTAMP_HEADER },
    })
  }

  return NextResponse.json({ error: 'invalid_action', valid: ['verify', 'generate_secret'] }, { status: 400 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST = tracedRoute('POST', '/api/webhooks/verify-signature', _POST)
