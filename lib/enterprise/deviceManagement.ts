/**
 * D2 Identity — EMM device controls + remote-wipe signaling.
 *
 * Enterprise mobility management: an org enforces a device policy (screen lock,
 * trusted-device requirement, minimum app version) and can remotely wipe a lost
 * device. Wipe is a SIGNAL, not a silent server-side delete: an admin requests
 * it (wipe_requested_at), the device's client polls getWipeSignal, performs the
 * local wipe, and acknowledges (wiped_at). Requesting a wipe also revokes the
 * device's server sessions so it cannot continue acting while offline.
 *
 * EMM policy is stored in system_config under `emm_policy`; the pure validation
 * helper keeps the route thin.
 */
import type { Pool } from 'pg'

// ── Remote-wipe signaling ────────────────────────────────────────────

export type RequestWipeResult =
  | { ok: true; deviceId: string; sessionsRevoked: number }
  | { ok: false; code: 'not_found' }

/**
 * Request a remote wipe of a device: stamp wipe_requested_at and revoke the
 * device's server sessions. The client completes the wipe and acknowledges.
 * Idempotent — re-requesting refreshes the timestamp.
 */
export async function requestRemoteWipe(
  pool: Pool,
  deviceId: string,
  actorId: string
): Promise<RequestWipeResult> {
  const now = Date.now()
  const { rowCount } = await pool.query(
    `UPDATE aaelink.devices SET wipe_requested_at = $2, wiped_at = 0 WHERE id = $1`,
    [deviceId, now]
  )
  if (!rowCount) return { ok: false, code: 'not_found' }

  const { rowCount: revoked } = await pool.query(
    `DELETE FROM aaelink.sessions WHERE device_id = $1`,
    [deviceId]
  )

  await pool.query(
    `INSERT INTO aaelink.audit_log (id, actor_id, action, target_type, target_id, created_at)
     VALUES (gen_random_uuid()::text, $1, 'device_wipe_requested', 'device', $2, $3)`,
    [actorId, deviceId, now]
  ).catch(() => { /* audit is best-effort */ })

  return { ok: true, deviceId, sessionsRevoked: revoked ?? 0 }
}

export interface WipeSignal {
  device_id: string
  /** True when a wipe is pending and the client has not yet acknowledged it. */
  wipe_requested: boolean
  wipe_requested_at: number
  wiped_at: number
}

/** Read a device's wipe signal — the value a client polls. Null when unknown. */
export async function getWipeSignal(pool: Pool, deviceId: string): Promise<WipeSignal | null> {
  const { rows } = await pool.query<{ wipe_requested_at: string; wiped_at: string }>(
    `SELECT wipe_requested_at::text, wiped_at::text FROM aaelink.devices WHERE id = $1`,
    [deviceId]
  )
  const row = rows[0]
  if (!row) return null
  const requestedAt = Number(row.wipe_requested_at)
  const wipedAt = Number(row.wiped_at)
  return {
    device_id: deviceId,
    wipe_requested: requestedAt > 0 && wipedAt === 0,
    wipe_requested_at: requestedAt,
    wiped_at: wipedAt,
  }
}

export type AcknowledgeWipeResult =
  | { ok: true; deviceId: string }
  | { ok: false; code: 'not_found' | 'not_requested' }

/** Client acknowledges it completed the local wipe; records wiped_at. */
export async function acknowledgeWipe(pool: Pool, deviceId: string): Promise<AcknowledgeWipeResult> {
  const { rows } = await pool.query<{ wipe_requested_at: string; wiped_at: string }>(
    `SELECT wipe_requested_at::text, wiped_at::text FROM aaelink.devices WHERE id = $1`,
    [deviceId]
  )
  const row = rows[0]
  if (!row) return { ok: false, code: 'not_found' }
  if (Number(row.wipe_requested_at) <= 0) return { ok: false, code: 'not_requested' }

  await pool.query(
    `UPDATE aaelink.devices SET wiped_at = $2 WHERE id = $1`,
    [deviceId, Date.now()]
  )
  return { ok: true, deviceId }
}

// ── EMM policy ───────────────────────────────────────────────────────

export interface EmmPolicy {
  /** Clients must require a device screen lock. */
  screen_lock_required: boolean
  /** Only devices marked trusted may hold sessions. */
  require_trusted_device: boolean
  /** Minimum acceptable client app version ('' = unrestricted). */
  min_app_version: string
  /** Idle minutes before the client locks the screen (0 = client default). */
  screen_lock_timeout_minutes: number
}

export const DEFAULT_EMM_POLICY: EmmPolicy = {
  screen_lock_required: false,
  require_trusted_device: false,
  min_app_version: '',
  screen_lock_timeout_minutes: 0,
}

export function validateEmmPatch(patch: Partial<EmmPolicy>): { field: string; message: string } | null {
  if (patch.screen_lock_timeout_minutes !== undefined &&
      (typeof patch.screen_lock_timeout_minutes !== 'number' ||
       patch.screen_lock_timeout_minutes < 0 || patch.screen_lock_timeout_minutes > 1440)) {
    return { field: 'screen_lock_timeout_minutes', message: 'out_of_range (0-1440m)' }
  }
  if (patch.min_app_version !== undefined && typeof patch.min_app_version !== 'string') {
    return { field: 'min_app_version', message: 'must_be_string' }
  }
  return null
}

const EMM_KEY = 'emm_policy'

function parseEmm(value: string | undefined): EmmPolicy {
  if (!value) return { ...DEFAULT_EMM_POLICY }
  try {
    return { ...DEFAULT_EMM_POLICY, ...(JSON.parse(value) as Partial<EmmPolicy>) }
  } catch {
    return { ...DEFAULT_EMM_POLICY }
  }
}

/** Current EMM policy (defaults merged over stored overrides). */
export async function getEmmPolicy(pool: Pool): Promise<EmmPolicy> {
  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = $1`, [EMM_KEY]
  )
  return parseEmm(rows[0]?.value)
}

/** Merge a validated patch into the EMM policy and persist it. Throws on a bad value. */
export async function updateEmmPolicy(pool: Pool, patch: Partial<EmmPolicy>): Promise<EmmPolicy> {
  const violation = validateEmmPatch(patch)
  if (violation) throw new Error(`${violation.field}: ${violation.message}`)

  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = $1`, [EMM_KEY]
  )
  const updated: EmmPolicy = { ...parseEmm(rows[0]?.value), ...patch }
  await pool.query(
    `INSERT INTO aaelink.system_config (key, value, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3`,
    [EMM_KEY, JSON.stringify(updated), Date.now()]
  )
  return updated
}
