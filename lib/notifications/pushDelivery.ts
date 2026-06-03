/**
 * AAELink — Real push notification delivery (FCM HTTP v1 + APNS path).
 *
 * Invoked by the `push_deliver` worker job. Loads the target user's active
 * device tokens from `aaelink.push_tokens`, dispatches per provider, and
 * cleans up tokens the provider reports as permanently invalid.
 *
 * Credential model (env-only, see fcmAuth.ts):
 *   - FCM  : FCM_PROJECT_ID + (FCM_ACCESS_TOKEN | FCM_SERVICE_ACCOUNT_JSON)
 *   - APNS : APNS_* — not wired to a raw HTTP/2 client here (needs a dep we
 *            cannot add); when creds are present we still cannot deliver, so
 *            we surface `apns_unconfigured` and skip rather than fake success.
 *
 * GRACEFUL NO-OP: when a provider has no credentials, its tokens are skipped
 * and logged once per job — the handler never throws, so the worker does not
 * retry a job it can never complete.
 */
import type { Pool } from 'pg'
import { log } from '@/lib/infra/log'
import { getFcmAccessToken } from '@/lib/notifications/fcmAuth'

const FCM_SEND_URL = (projectId: string) =>
  `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`

export interface PushDeliverPayload {
  user_id?: string
  user_ids?: string[]
  title?: string
  body?: string
  channel_id?: string
  badge_count?: number
  silent?: boolean
  priority?: string
  log_id?: string
}

export interface PushTokenRow {
  id: string
  token: string
  provider: string
}

export interface PushDeliveryResult {
  sent: number
  failed: number
  stale: number
  skipped_apns: number
  no_creds: boolean
}

/** FCM error statuses that mean the token will never work again. */
const FCM_STALE_STATUSES = new Set([
  'UNREGISTERED',
  'INVALID_ARGUMENT',
  'NOT_FOUND',
])

function targetUserIds(p: PushDeliverPayload): string[] {
  const ids = new Set<string>()
  if (p.user_id) ids.add(p.user_id)
  for (const u of p.user_ids || []) if (u) ids.add(u)
  return [...ids]
}

async function loadTokens(pool: Pool, userIds: string[]): Promise<PushTokenRow[]> {
  if (userIds.length === 0) return []
  const { rows } = await pool.query<PushTokenRow>(
    `SELECT id, token, provider FROM aaelink.push_tokens
     WHERE user_id = ANY($1) AND is_active = true`,
    [userIds],
  )
  return rows
}

async function markStale(pool: Pool, tokenIds: string[]): Promise<void> {
  if (tokenIds.length === 0) return
  await pool.query(
    `UPDATE aaelink.push_tokens SET is_active = false WHERE id = ANY($1)`,
    [tokenIds],
  )
}

/** Shape an FCM HTTP v1 message body for one device token. */
export function buildFcmMessage(token: string, p: PushDeliverPayload): unknown {
  const priority = p.priority === 'high' ? 'high' : 'normal'
  const data: Record<string, string> = {}
  if (p.channel_id) data.channel_id = p.channel_id
  if (p.badge_count != null) data.badge = String(p.badge_count)

  if (p.silent) {
    // Data-only message for background sync — no notification block.
    return { message: { token, data, android: { priority } } }
  }
  return {
    message: {
      token,
      notification: { title: p.title || '', body: p.body || '' },
      data,
      android: { priority },
    },
  }
}

async function sendOneFcm(
  projectId: string,
  bearer: string,
  row: PushTokenRow,
  payload: PushDeliverPayload,
  fetchImpl: typeof fetch,
): Promise<'sent' | 'stale' | 'failed'> {
  const res = await fetchImpl(FCM_SEND_URL(projectId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildFcmMessage(row.token, payload)),
  })
  if (res.ok) return 'sent'

  const errBody = (await res.json().catch(() => ({}))) as {
    error?: { status?: string; details?: Array<{ errorCode?: string }> }
  }
  const status =
    errBody.error?.details?.[0]?.errorCode || errBody.error?.status || ''
  if (res.status === 404 || res.status === 400 || FCM_STALE_STATUSES.has(status)) {
    return 'stale'
  }
  return 'failed'
}

/**
 * Deliver a push job. Never throws on a single bad token; only throws on a
 * systemic, retryable failure (e.g. FCM token exchange error).
 */
export async function deliverPush(
  pool: Pool,
  payload: PushDeliverPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<PushDeliveryResult> {
  const result: PushDeliveryResult = {
    sent: 0, failed: 0, stale: 0, skipped_apns: 0, no_creds: false,
  }

  const userIds = targetUserIds(payload)
  if (userIds.length === 0) return result

  const tokens = await loadTokens(pool, userIds)
  if (tokens.length === 0) return result

  const projectId = process.env.FCM_PROJECT_ID || ''
  const bearer = projectId ? await getFcmAccessToken(fetchImpl) : null

  const apnsConfigured = Boolean(
    process.env.APNS_AUTH_KEY && process.env.APNS_KEY_ID &&
    process.env.APNS_TEAM_ID && process.env.APNS_BUNDLE_ID,
  )

  if (!bearer) result.no_creds = true

  const stale: string[] = []
  for (const row of tokens) {
    if (row.provider === 'apns') {
      // No raw HTTP/2 APNS client available without a new dep. Never fake it.
      result.skipped_apns++
      continue
    }
    // fcm + web both ride the FCM HTTP v1 endpoint.
    if (!bearer || !projectId) continue
    try {
      const outcome = await sendOneFcm(projectId, bearer, row, payload, fetchImpl)
      if (outcome === 'sent') result.sent++
      else if (outcome === 'stale') { result.stale++; stale.push(row.id) }
      else result.failed++
    } catch (err: unknown) {
      result.failed++
      log.info(`   ⚠️ fcm send error: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  }

  await markStale(pool, stale)

  if (result.no_creds && tokens.some(t => t.provider !== 'apns')) {
    log.info('   ⏭️ push_deliver: FCM credentials not configured — no-op (set FCM_PROJECT_ID + FCM_SERVICE_ACCOUNT_JSON)')
  }
  if (result.skipped_apns > 0 && !apnsConfigured) {
    log.info(`   ⏭️ apns_unconfigured: skipped ${result.skipped_apns} APNS token(s)`)
  } else if (result.skipped_apns > 0) {
    log.info(`   ⏭️ apns_no_raw_client: skipped ${result.skipped_apns} APNS token(s) (HTTP/2 client unavailable without dep)`)
  }

  return result
}
