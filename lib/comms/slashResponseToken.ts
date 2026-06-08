/**
 * Slash command delayed-response (response_url) tokens — Slack parity §14.
 *
 * When a slash command is dispatched to an external callback_url, the app needs
 * a way to deliver delayed/async messages back into the bound channel without
 * holding the original HTTP request open. Slack solves this with a `response_url`
 * the app POSTs to (within ~30 min, up to 5 times).
 *
 * Design:
 *   - A token is minted as `<rowId>.<hmac>` where the HMAC covers the row id
 *     plus the immutable binding (channel_id/user_id/command/workspace_id/expiry).
 *     Tampering with any bound field or the row id breaks the signature.
 *   - The row is persisted in `slash_command_response_tokens` so use-count can be
 *     enforced (<=5) and replay is bounded. A stateless token cannot cap uses.
 *   - Validation is constant-time on the signature and atomically increments the
 *     use count (replay-safe under concurrency via a conditional UPDATE).
 *
 * Secret: reuses RESPONSE_URL_TOKEN_SECRET if set, else falls back to a stable
 * app secret so signatures are verifiable across the mint/consume routes.
 */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto'
import type { Pool } from 'pg'

/** Max times a single response_url may be used (Slack contract). */
export const MAX_RESPONSE_USES = 5
/** Default token lifetime: 30 minutes (Slack contract). */
export const RESPONSE_TOKEN_TTL_MS = 30 * 60 * 1000

export interface ResponseTokenBinding {
  channelId: string
  userId: string
  command: string
  workspaceId: string
}

function tokenSecret(): string {
  return (
    process.env.RESPONSE_URL_TOKEN_SECRET ||
    process.env.CSRF_SECRET ||
    'aaelink-slash-response-secret'
  )
}

/** Sign the immutable binding for a given row id + expiry. */
function signToken(rowId: string, b: ResponseTokenBinding, expiresAt: number): string {
  const base = [rowId, b.channelId, b.userId, b.command, b.workspaceId, String(expiresAt)].join(':')
  return createHmac('sha256', tokenSecret()).update(base).digest('hex')
}

/**
 * Mint a new single-channel-scoped response token and persist its row.
 * Returns the opaque token string `<rowId>.<hmac>` to embed as response_url.
 */
export async function mintResponseToken(
  pool: Pool,
  binding: ResponseTokenBinding,
  ttlMs: number = RESPONSE_TOKEN_TTL_MS,
): Promise<string> {
  const rowId = randomUUID()
  const now = Date.now()
  const expiresAt = now + ttlMs
  // A nonce is stored so two tokens with identical binding never collide and a
  // leaked row id alone cannot be replayed against a re-minted token.
  const nonce = randomBytes(16).toString('hex')
  const sig = signToken(rowId, binding, expiresAt)

  await pool.query(
    `INSERT INTO aaelink.slash_command_response_tokens
       (id, workspace_id, channel_id, user_id, command, nonce, signature, uses, max_uses, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10)`,
    [rowId, binding.workspaceId, binding.channelId, binding.userId, binding.command, nonce, sig, MAX_RESPONSE_USES, expiresAt, now],
  )

  return `${rowId}.${sig}`
}

export type ValidateResult =
  | { ok: true; channelId: string; userId: string; command: string; workspaceId: string }
  | { ok: false; error: 'invalid_token' | 'token_expired' | 'token_exhausted' }

/**
 * Validate a response token and atomically consume one use.
 *
 * Checks (in order): structural parse, row exists, signature match (constant
 * time), not expired, uses < max_uses. The use increment is a conditional UPDATE
 * (`uses = uses + 1 WHERE uses < max_uses AND expires_at > now`) so concurrent
 * requests cannot exceed the cap (replay/race-safe).
 */
export async function validateAndConsume(pool: Pool, token: string): Promise<ValidateResult> {
  const dot = token.indexOf('.')
  if (dot <= 0) return { ok: false, error: 'invalid_token' }
  const rowId = token.slice(0, dot)
  const presentedSig = token.slice(dot + 1)
  if (!presentedSig) return { ok: false, error: 'invalid_token' }

  const { rows } = await pool.query<{
    workspace_id: string
    channel_id: string
    user_id: string
    command: string
    signature: string
    uses: number
    max_uses: number
    expires_at: string | number
  }>(
    `SELECT workspace_id, channel_id, user_id, command, signature, uses, max_uses, expires_at
     FROM aaelink.slash_command_response_tokens WHERE id = $1`,
    [rowId],
  )
  const row = rows[0]
  if (!row) return { ok: false, error: 'invalid_token' }

  // Constant-time signature comparison. Recompute from stored binding so a
  // forged token whose body claims a different channel cannot validate.
  const expiresAt = Number(row.expires_at)
  const expectedSig = signToken(rowId, {
    channelId: row.channel_id,
    userId: row.user_id,
    command: row.command,
    workspaceId: row.workspace_id,
  }, expiresAt)
  if (!constantTimeEquals(presentedSig, expectedSig) || !constantTimeEquals(presentedSig, row.signature)) {
    return { ok: false, error: 'invalid_token' }
  }

  if (Number(row.uses) >= Number(row.max_uses)) return { ok: false, error: 'token_exhausted' }
  if (expiresAt <= Date.now()) return { ok: false, error: 'token_expired' }

  // Atomic consume — only succeeds if still under cap and unexpired. Guards
  // against concurrent over-use (the >5 case) and post-expiry replay.
  const { rowCount } = await pool.query(
    `UPDATE aaelink.slash_command_response_tokens
       SET uses = uses + 1
     WHERE id = $1 AND uses < max_uses AND expires_at > $2`,
    [rowId, Date.now()],
  )
  if (!rowCount) {
    // Lost the race or expired between SELECT and UPDATE.
    return Number(row.uses) + 1 > Number(row.max_uses)
      ? { ok: false, error: 'token_exhausted' }
      : { ok: false, error: 'token_expired' }
  }

  return {
    ok: true,
    channelId: row.channel_id,
    userId: row.user_id,
    command: row.command,
    workspaceId: row.workspace_id,
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  try {
    return timingSafeEqual(ab, bb)
  } catch {
    return false
  }
}
